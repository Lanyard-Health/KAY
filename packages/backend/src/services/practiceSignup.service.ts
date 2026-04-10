import { prisma } from '../utils/prisma.js';
import { createCognitoUser, setCognitoUserPassword, deleteCognitoUser } from './cognitoUser.service.js';
import { triggerAutomatedEmail } from './automatedEmail.service.js';
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
          addressLine1: data.addressLine1,
          addressLine2: data.addressLine2,
          city: data.city,
          state: data.state,
          zipCode: data.zipCode,
          states: data.operatingStates,
          targetPayerIds: data.targetPayerIds,
          isEnterprise: data.isEnterprise ?? false,
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

      // Create default PracticeSettings
      await tx.practiceSettings.create({
        data: {
          practiceId: practice.id,
        },
      });

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
