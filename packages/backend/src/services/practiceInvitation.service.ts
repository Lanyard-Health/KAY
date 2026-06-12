import { createHash, randomBytes } from 'node:crypto';
import type { PracticeRole, UserRole } from '@prisma/client';
import { prisma } from '../utils/prisma.js';
import { createCognitoUser, setCognitoUserPassword, deleteCognitoUser } from './cognitoUser.service.js';
import { renderProviderActionEmail } from './email-templates.js';
import { emailService } from './email.service.js';
import { logger } from '../utils/logger.js';

const INVITE_TTL_DAYS = 7;
const TTL_MS = INVITE_TTL_DAYS * 24 * 60 * 60 * 1000;

// The raw token is emailed; only its SHA-256 hash is ever stored.
function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

function acceptUrl(rawToken: string): string {
  const base = process.env['FRONTEND_URL'] ?? 'https://portal.lanyardhealth.com';
  return `${base.replace(/\/$/, '')}/accept-invitation/${rawToken}`;
}

// The new login's platform role. Practice membership role lives on UserPractice;
// everything except a provider invite gets the practice_admin platform role.
function userRoleForInvite(role: PracticeRole): UserRole {
  return role === 'PROVIDER' ? 'provider' : 'practice_admin';
}

// "pending" past its expiry reads as "expired" without needing a sweep job.
function effectiveStatus(inv: { status: string; expiresAt: Date }): string {
  if (inv.status === 'pending' && inv.expiresAt.getTime() < Date.now()) return 'expired';
  return inv.status;
}

async function sendInvitationEmail(params: { email: string; practiceName: string; rawToken: string }) {
  const html = renderProviderActionEmail({
    previewText: `You've been invited to join ${params.practiceName} on Lanyard Health`,
    heading: `Join ${params.practiceName} on Lanyard Health`,
    firstName: 'there',
    paragraphs: [
      `You've been invited to join ${params.practiceName} on Lanyard Health, the platform that handles provider credentialing and payer enrollment.`,
      'Use the button below to set your password and finish setting up your account.',
    ],
    cta: { label: 'Accept invitation', url: acceptUrl(params.rawToken) },
    reassurance: `This link expires in ${INVITE_TTL_DAYS} days. If you weren't expecting this invitation, you can ignore this email.`,
  });

  const result = await emailService.sendEmail({
    to: params.email,
    subject: `You're invited to join ${params.practiceName} on Lanyard Health`,
    html,
    notificationType: 'practice_invitation',
  });
  if (!result.success) {
    logger.error('Failed to send practice invitation email', { email: params.email, error: result.error });
    throw new Error('EMAIL_SEND_FAILED');
  }
}

export interface CreateInvitationParams {
  practiceId: string;
  email: string;
  role: PracticeRole;
  invitedById?: string | null;
}

export async function createInvitation(params: CreateInvitationParams) {
  const practice = await prisma.practice.findUnique({
    where: { id: params.practiceId },
    select: { id: true, name: true },
  });
  if (!practice) throw new Error('PRACTICE_NOT_FOUND');

  const email = params.email.trim().toLowerCase();

  // The accept flow creates a brand-new login, so a pre-existing account for
  // this email can't be redeemed here — point the admin at "add existing user".
  const existingUser = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (existingUser) throw new Error('EMAIL_EXISTS');

  // Supersede any still-pending invite for the same email + practice.
  await prisma.practiceInvitation.updateMany({
    where: { practiceId: params.practiceId, email, status: 'pending' },
    data: { status: 'revoked' },
  });

  const rawToken = randomBytes(32).toString('hex');
  const invitation = await prisma.practiceInvitation.create({
    data: {
      practiceId: params.practiceId,
      email,
      role: params.role,
      tokenHash: hashToken(rawToken),
      expiresAt: new Date(Date.now() + TTL_MS),
      invitedById: params.invitedById ?? null,
    },
    select: { id: true, email: true, role: true, status: true, expiresAt: true, createdAt: true },
  });

  await sendInvitationEmail({ email, practiceName: practice.name, rawToken });
  return invitation;
}

export async function resendInvitation(id: string) {
  const inv = await prisma.practiceInvitation.findUnique({
    where: { id },
    include: { practice: { select: { name: true } } },
  });
  if (!inv) throw new Error('INVITATION_NOT_FOUND');
  if (inv.status === 'accepted') throw new Error('ALREADY_ACCEPTED');

  const rawToken = randomBytes(32).toString('hex');
  await prisma.practiceInvitation.update({
    where: { id },
    data: { tokenHash: hashToken(rawToken), status: 'pending', expiresAt: new Date(Date.now() + TTL_MS), acceptedAt: null },
  });

  await sendInvitationEmail({ email: inv.email, practiceName: inv.practice.name, rawToken });
  return { id };
}

export async function revokeInvitation(id: string) {
  const inv = await prisma.practiceInvitation.findUnique({ where: { id }, select: { id: true, status: true } });
  if (!inv) throw new Error('INVITATION_NOT_FOUND');
  if (inv.status === 'accepted') throw new Error('ALREADY_ACCEPTED');

  return prisma.practiceInvitation.update({
    where: { id },
    data: { status: 'revoked' },
    select: { id: true, status: true },
  });
}

export async function listInvitations(practiceId: string) {
  const rows = await prisma.practiceInvitation.findMany({
    where: { practiceId },
    orderBy: { createdAt: 'desc' },
    select: { id: true, email: true, role: true, status: true, expiresAt: true, acceptedAt: true, createdAt: true },
  });
  return rows.map((r) => ({ ...r, status: effectiveStatus(r) }));
}

// Public: resolve a raw token to the minimal detail the accept page needs.
export async function getInvitationByToken(rawToken: string) {
  const inv = await prisma.practiceInvitation.findUnique({
    where: { tokenHash: hashToken(rawToken) },
    include: { practice: { select: { name: true } } },
  });
  if (!inv) return { status: 'invalid' as const };
  return {
    status: effectiveStatus(inv),
    email: inv.email,
    practiceName: inv.practice.name,
    role: inv.role,
  };
}

export interface AcceptInvitationParams {
  token: string;
  password: string;
  firstName: string;
  lastName: string;
}

export async function acceptInvitation(params: AcceptInvitationParams) {
  const inv = await prisma.practiceInvitation.findUnique({
    where: { tokenHash: hashToken(params.token) },
    include: { practice: { select: { id: true, name: true } } },
  });
  if (!inv) throw new Error('INVALID_TOKEN');
  if (inv.status === 'accepted') throw new Error('ALREADY_USED');
  if (inv.status === 'revoked') throw new Error('REVOKED');
  if (inv.expiresAt.getTime() < Date.now()) {
    await prisma.practiceInvitation.update({ where: { id: inv.id }, data: { status: 'expired' } }).catch(() => {});
    throw new Error('EXPIRED');
  }

  const email = inv.email;
  const existingUser = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (existingUser) throw new Error('EMAIL_EXISTS');

  const { cognitoId } = await createCognitoUser({
    email,
    firstName: params.firstName,
    lastName: params.lastName,
    suppressInviteEmail: true,
  });

  try {
    await setCognitoUserPassword(email, params.password, true);

    const user = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          cognitoId,
          email,
          firstName: params.firstName,
          lastName: params.lastName,
          role: userRoleForInvite(inv.role),
        },
      });
      await tx.userPractice.create({
        data: { userId: created.id, practiceId: inv.practiceId, role: inv.role },
      });
      await tx.practiceInvitation.update({
        where: { id: inv.id },
        data: { status: 'accepted', acceptedAt: new Date() },
      });
      return created;
    });

    return { userId: user.id, email, practiceId: inv.practiceId, practiceName: inv.practice.name };
  } catch (err) {
    // Roll back the Cognito user so a failed accept can be retried.
    await deleteCognitoUser(email).catch(() => {});
    throw err;
  }
}
