import { prisma } from '../utils/prisma.js';
import { createCognitoUser, setCognitoUserPassword, deleteCognitoUser } from './cognitoUser.service.js';
import { emailService } from './email.service.js';
import { logger } from '../utils/logger.js';
import type { PracticeSignupInput } from '@credential-management/shared';

export async function registerPractice(data: PracticeSignupInput) {
  // 1. Check email uniqueness
  const existingUser = await prisma.user.findUnique({ where: { email: data.email } });
  if (existingUser) {
    throw new Error('EMAIL_EXISTS');
  }

  // 2. Create Cognito user (suppress invite — we set password directly)
  const { cognitoId } = await createCognitoUser({
    email: data.email,
    firstName: data.firstName,
    lastName: data.lastName,
    suppressInviteEmail: true,
  });

  try {
    // 3. Set permanent password
    await setCognitoUserPassword(data.email, data.password, true);

    // 4. Create Practice + User + UserPractice in a transaction
    const { practice, user } = await prisma.$transaction(async (tx) => {
      const practice = await tx.practice.create({
        data: {
          name: data.practiceName,
          email: data.email,
          phone: data.phone,
          status: 'ACTIVE',
        },
      });

      const user = await tx.user.create({
        data: {
          cognitoId,
          email: data.email,
          firstName: data.firstName,
          lastName: data.lastName,
          phone: data.phone,
          role: 'practice_admin',
        },
      });

      await tx.userPractice.create({
        data: {
          userId: user.id,
          practiceId: practice.id,
          role: 'SUPER_ADMIN',
        },
      });

      return { practice, user };
    });

    // 5. Send welcome email (non-blocking)
    if (emailService.isConfigured()) {
      const appUrl = process.env['APP_URL'] || process.env['FRONTEND_URL'] || 'http://localhost:5190';
      emailService.sendEmail({
        to: data.email,
        subject: 'Welcome to Lanyard Health',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #0A3D2E;">Welcome to Lanyard Health!</h2>
            <p>Dear ${data.firstName},</p>
            <p>Your practice <strong>${data.practiceName}</strong> has been registered successfully.</p>
            <div style="background-color: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 16px; margin: 20px 0;">
              <h3 style="margin-top: 0; color: #0A3D2E;">Getting Started</h3>
              <p>You can now log in and start managing your credentialing workflow.</p>
              <p>
                <a href="${appUrl}/login" style="background-color: #0A3D2E; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">
                  Log In to Lanyard Health
                </a>
              </p>
            </div>
            <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;" />
            <p style="color: #6b7280; font-size: 12px;">
              This is an automated notification from Lanyard Health. Please do not reply to this email.
            </p>
          </div>
        `,
        notificationType: 'application_approved',
      }).catch((err: unknown) => logger.error('Failed to send welcome email:', err));
    }

    return { userId: user.id, practiceId: practice.id, email: user.email };
  } catch (err) {
    // 6. Roll back Cognito user on any failure
    await deleteCognitoUser(data.email).catch(() => {});
    throw err;
  }
}
