import { prisma } from '../utils/prisma.js';
import { createCognitoUser, setCognitoUserPassword, deleteCognitoUser } from './cognitoUser.service.js';
import { triggerAutomatedEmail } from './automatedEmail.service.js';
import { encryptSafe } from '../utils/crypto.js';
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
      const tin = data.groupTin?.trim();
      const practice = await tx.practice.create({
        data: {
          name: data.practiceName,
          email: data.email,
          phone: data.phone,
          status: 'ACTIVE',
          addressLine1: data.addressLine1,
          addressLine2: data.addressLine2,
          city: data.city,
          state: data.state,
          zipCode: data.zipCode,
          states: data.operatingStates,
          targetPayerIds: data.targetPayerIds,
          isEnterprise: data.isEnterprise ?? false,
          groupNpi: data.groupNpi,
          // Group profile intake
          legalName: data.legalName || null,
          dba: data.dba || null,
          entityType: data.entityType || null,
          groupSpecialty: data.groupSpecialty || null,
          emrVendor: data.emrVendor || null,
          billingVendor: data.billingVendor || null,
          billingClearinghouse: data.billingClearinghouse || null,
          ...(tin ? { taxIdEncrypted: encryptSafe(tin), taxIdLast4: tin.replace(/\D/g, '').slice(-4) || null } : {}),
          billingAddressLine1: data.billingAddressLine1 || null,
          billingAddressLine2: data.billingAddressLine2 || null,
          billingCity: data.billingCity || null,
          billingState: data.billingState || null,
          billingZipCode: data.billingZipCode || null,
          mailingAddressLine1: data.mailingAddressLine1 || null,
          mailingAddressLine2: data.mailingAddressLine2 || null,
          mailingCity: data.mailingCity || null,
          mailingState: data.mailingState || null,
          mailingZipCode: data.mailingZipCode || null,
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

      // Ownership disclosure (up to 3). SSN + DOB are encrypted at rest; only the
      // SSN last-4 is kept in clear for display, matching the ProviderBanking pattern.
      if (data.owners && data.owners.length > 0) {
        await tx.practiceOwner.createMany({
          data: data.owners.slice(0, 3).map((o) => {
            const ssnDigits = o.ssn ? o.ssn.replace(/\D/g, '') : '';
            return {
              practiceId: practice.id,
              name: o.name,
              ...(ssnDigits ? { ssnEncrypted: encryptSafe(ssnDigits), ssnLast4: ssnDigits.slice(-4) } : {}),
              ...(o.dateOfBirth ? { dateOfBirthEncrypted: encryptSafe(o.dateOfBirth) } : {}),
              ...(o.ownershipPercentage !== undefined ? { ownershipPercentage: o.ownershipPercentage } : {}),
              homeAddressLine1: o.homeAddressLine1 || null,
              homeAddressLine2: o.homeAddressLine2 || null,
              homeCity: o.homeCity || null,
              homeState: o.homeState || null,
              homeZipCode: o.homeZipCode || null,
              createdById: user.id,
            };
          }),
        });
      }

      // Create default PracticeSettings
      await tx.practiceSettings.create({
        data: {
          practiceId: practice.id,
        },
      });

      // Seed PracticePayer rows for each target payer so the settings UI
      // has a record to edit without a second round-trip.
      if (data.targetPayerIds && data.targetPayerIds.length > 0) {
        const existingPayers = await tx.payer.findMany({
          where: { id: { in: data.targetPayerIds } },
          select: { id: true },
        });
        if (existingPayers.length > 0) {
          await tx.practicePayer.createMany({
            data: existingPayers.map((p) => ({
              practiceId: practice.id,
              payerId: p.id,
            })),
            skipDuplicates: true,
          });
        }
      }

      // If enterprise, create EnterpriseQueue entry
      if (data.isEnterprise) {
        await tx.enterpriseQueue.create({
          data: {
            practiceId: practice.id,
            status: 'PENDING',
          },
        });
      }

      return { practice, user };
    });

    // 5. Send welcome email via template (non-blocking)
    triggerAutomatedEmail('SIGNUP_COMPLETE', practice.id)
      .catch((err: unknown) => logger.error('Failed to trigger welcome email:', err));

    return { userId: user.id, practiceId: practice.id, email: user.email };
  } catch (err) {
    // 6. Roll back Cognito user on any failure
    await deleteCognitoUser(data.email).catch(() => {});
    throw err;
  }
}
