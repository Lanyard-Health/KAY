import { prisma, prismaBase } from '../utils/prisma.js';
import { enqueueCaqhImport } from '../queues/caqh-import.queue.js';
import { emailService } from './email.service.js';
import { createCognitoUser, setCognitoUserPassword, deleteCognitoUser } from './cognitoUser.service.js';
import { notificationService } from './notification.service.js';
import { logger } from '../utils/logger.js';

export interface ProviderApplicationInput {
  npi: string;
  firstName: string;
  lastName: string;
  middleName?: string;
  suffix?: string;
  email: string;
  phone: string;
  dateOfBirth: string;
  gender: string;
  providerType?: string;
  taxonomy?: string;
  specialties?: string[];
  caqhProviderId?: string;
  practiceId?: string;
  previousApplicationId?: string;
}

/**
 * ProviderProfile.caqhProviderId is unique. Catch a taken ID at submission time with a
 * friendly message instead of a P2002 crash at approval time. Uses the bypass client so
 * archived providers count too (the DB constraint doesn't care about soft-deletes).
 * Public path — message must not reveal whose ID it is or whether they're archived.
 */
async function assertCaqhIdAvailable(caqhProviderId: string) {
  const providerWithCaqhId = await prismaBase.providerProfile.findFirst({
    where: { caqhProviderId },
    select: { id: true },
  });
  if (providerWithCaqhId) {
    throw new Error('A provider with this CAQH Provider ID already exists in our system');
  }
}

/**
 * Check if a pending application with this NPI already exists
 */
export async function checkExistingApplication(npi: string) {
  return prisma.providerApplication.findFirst({
    where: {
      npi,
      status: 'pending',
    },
  });
}

/**
 * Check if the NPI has a rejected application (allows re-application)
 */
export async function checkRejectedApplication(npi: string) {
  return prisma.providerApplication.findFirst({
    where: {
      npi,
      status: 'rejected',
    },
    orderBy: { submittedAt: 'desc' },
  });
}

/**
 * Check if a provider with this NPI already exists
 */
export async function checkExistingProvider(npi: string) {
  // Bypass the soft-delete filter so we can detect that an archived provider already holds
  // this NPI. The portal signup flow surfaces a distinct "archived — contact admin" message
  // for that case instead of generic "already exists".
  return prismaBase.providerProfile.findUnique({
    where: { npi },
    select: { id: true, npi: true, deletedAt: true },
  });
}

/**
 * Submit a new provider application
 */
export async function submitApplication(data: ProviderApplicationInput) {
  // Check for existing pending application
  const existingApplication = await checkExistingApplication(data.npi);
  if (existingApplication) {
    throw new Error('An application with this NPI is already pending review');
  }

  // Check for existing provider
  const existingProvider = await checkExistingProvider(data.npi);
  if (existingProvider) {
    throw new Error('A provider with this NPI already exists in our system');
  }

  // Check for existing user with this email
  const existingUser = await prisma.user.findUnique({ where: { email: data.email } });
  if (existingUser) {
    throw new Error('An account with this email address already exists');
  }

  // CAQH ID collisions: against existing providers and other pending applications
  if (data.caqhProviderId) {
    await assertCaqhIdAvailable(data.caqhProviderId);
    const pendingWithCaqhId = await prisma.providerApplication.findFirst({
      where: { caqhProviderId: data.caqhProviderId, status: 'pending' },
      select: { id: true },
    });
    if (pendingWithCaqhId) {
      throw new Error('An application with this CAQH Provider ID is already pending review');
    }
  }

  // Validate previousApplicationId if provided
  let previousApplicationId: string | undefined;
  if (data.previousApplicationId) {
    const prevApp = await prisma.providerApplication.findUnique({
      where: { id: data.previousApplicationId },
    });
    if (!prevApp || prevApp.status !== 'rejected') {
      throw new Error('Invalid previous application reference');
    }
    // Ensure no other re-application already links to this one
    const existingReapp = await prisma.providerApplication.findFirst({
      where: { previousApplicationId: data.previousApplicationId },
    });
    if (existingReapp) {
      throw new Error('A re-application has already been submitted for this application');
    }
    previousApplicationId = data.previousApplicationId;
  } else {
    // Also check by email: if email has a rejected application, auto-detect re-application
    const rejectedByEmail = await prisma.providerApplication.findFirst({
      where: { email: data.email, status: 'rejected' },
      orderBy: { submittedAt: 'desc' },
    });
    if (rejectedByEmail) {
      // Check no other re-app links to this one already
      const existingReapp = await prisma.providerApplication.findFirst({
        where: { previousApplicationId: rejectedByEmail.id },
      });
      if (!existingReapp) {
        previousApplicationId = rejectedByEmail.id;
      }
    }
  }

  // Create the application
  const application = await prisma.providerApplication.create({
    data: {
      npi: data.npi,
      firstName: data.firstName,
      lastName: data.lastName,
      middleName: data.middleName,
      suffix: data.suffix,
      email: data.email,
      phone: data.phone,
      dateOfBirth: new Date(data.dateOfBirth),
      gender: data.gender as any,
      providerType: data.providerType,
      taxonomy: data.taxonomy,
      specialties: data.specialties || [],
      ...(data.caqhProviderId && { caqhProviderId: data.caqhProviderId }),
      ...(data.practiceId && { practiceId: data.practiceId }),
      ...(previousApplicationId && { previousApplicationId }),
    },
  });

  // Create legacy admin notification
  await prisma.adminNotification.create({
    data: {
      type: 'NEW_APPLICATION',
      message: `New provider application from ${data.firstName} ${data.lastName}`,
      applicationId: application.id,
    },
  });

  // Create in-app notifications for all admin/staff users
  notificationService.notifyAdminUsers({
    type: 'new_application',
    title: 'New Provider Application',
    message: `${data.firstName} ${data.lastName} (NPI: ${data.npi}) submitted a new application.`,
    actionUrl: '/pending-providers',
    metadata: { applicationId: application.id, npi: data.npi },
  }).catch((err: unknown) => logger.error('Failed to create in-app notifications:', err));

  // Send email notification to admin (non-blocking)
  const adminEmail = process.env['ADMIN_EMAIL'];
  if (adminEmail && emailService.isConfigured()) {
    const appUrl = process.env['APP_URL'] || 'http://localhost:5190';
    emailService.sendEmail({
      to: adminEmail,
      subject: `New Provider Application: ${data.firstName} ${data.lastName}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #0A3D2E;">New Provider Application</h2>
          <p>A new provider has submitted an application for review.</p>

          <h3>Provider Details</h3>
          <ul>
            <li><strong>Name:</strong> ${data.firstName} ${data.lastName}</li>
            <li><strong>NPI:</strong> ${data.npi}</li>
            <li><strong>Email:</strong> ${data.email}</li>
            <li><strong>Phone:</strong> ${data.phone}</li>
          </ul>

          <p>
            <a href="${appUrl}/pending-providers" style="background-color: #0A3D2E; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">
              Review Application
            </a>
          </p>

          <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;" />
          <p style="color: #6b7280; font-size: 12px;">
            This is an automated notification from Lanyard Health.
          </p>
        </div>
      `,
    }).catch((err: unknown) => logger.error('Failed to send admin notification email:', err));
  }

  // Send confirmation email to provider (non-blocking)
  if (emailService.isConfigured()) {
    emailService.sendEmail({
      to: data.email,
      subject: 'Application Received — Lanyard Health',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #0A3D2E;">Application Received</h2>
          <p>Dear ${data.firstName},</p>
          <p>Thank you for submitting your provider registration with Lanyard Health. We have received your application and our credentialing team will review it shortly.</p>

          <div style="background-color: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 16px; margin: 20px 0;">
            <h3 style="margin-top: 0; color: #0A3D2E;">What happens next?</h3>
            <ul style="margin-bottom: 0;">
              <li>Our team will review your application</li>
              <li>You may be contacted for additional information</li>
              <li>You will receive an email notification once your application is approved</li>
            </ul>
          </div>

          <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;" />
          <p style="color: #6b7280; font-size: 12px;">
            This is an automated notification from Lanyard Health. Please do not reply to this email.
          </p>
        </div>
      `,
      notificationType: 'application_submitted',
    }).catch((err: unknown) => logger.error('Failed to send provider confirmation email:', err));
  }

  return application;
}

export interface SelfServeSignupInput extends ProviderApplicationInput {
  password: string;
}

/**
 * Self-serve signup — provider sets own password, gets instant access with pending_verification status
 */
export async function selfServeSignup(data: SelfServeSignupInput) {
  // 1. Check for existing pending application
  const existingApplication = await checkExistingApplication(data.npi);
  if (existingApplication) {
    throw new Error('An application with this NPI is already pending review');
  }

  // 2. Check for existing provider (including soft-deleted).
  //
  // SECURITY: this path is **public, pre-authentication, rate-limited**. We MUST NOT
  // surface a different error for "archived" vs "active duplicate" — that would let
  // an anonymous caller enumerate which NPIs are archived in our system by diffing
  // status codes (active → caught as "already exists" → 409 generic; archived →
  // distinct message → falls through to 500 in the route handler).
  //
  // Both cases throw the SAME message so the route's catch filter routes them
  // identically. Archived recovery is an admin path via DELETE /providers/:id/restore.
  // (Pre-existence leak from active duplicates is unchanged from before this PR.)
  const existingProvider = await checkExistingProvider(data.npi);
  if (existingProvider) {
    throw new Error('A provider with this NPI already exists in our system');
  }

  // 3. Check email uniqueness
  const existingUser = await prisma.user.findUnique({ where: { email: data.email } });
  if (existingUser) {
    throw new Error('An account with this email address already exists');
  }

  // 3b. CAQH ID collision — this path creates the provider row immediately, so a taken
  // ID would otherwise crash the transaction with a unique-constraint error
  if (data.caqhProviderId) {
    await assertCaqhIdAvailable(data.caqhProviderId);
  }

  // 4. Create Cognito user (suppress invite email — they already set their password)
  const { cognitoId } = await createCognitoUser({
    email: data.email,
    firstName: data.firstName,
    lastName: data.lastName,
    suppressInviteEmail: true,
  });

  try {
    // 5. Set permanent password
    await setCognitoUserPassword(data.email, data.password, true);

    // 6. Create Provider + User + Application in a transaction
    const { provider, application, newUser } = await prisma.$transaction(async (tx) => {
      const provider = await tx.providerProfile.create({
        data: {
          npi: data.npi,
          firstName: data.firstName,
          lastName: data.lastName,
          middleName: data.middleName,
          suffix: data.suffix,
          email: data.email,
          phone: data.phone,
          dateOfBirth: new Date(data.dateOfBirth),
          gender: data.gender as any,
          providerType: (data.providerType as any) || 'other',
          taxonomy: data.taxonomy,
          specialties: data.specialties || [],
          status: 'pending_verification',
          ...(data.caqhProviderId && { caqhProviderId: data.caqhProviderId }),
        },
      });

      const newUser = await tx.user.create({
        data: {
          cognitoId,
          email: data.email,
          firstName: data.firstName,
          lastName: data.lastName,
          phone: data.phone,
          role: 'provider',
          providerId: provider.id,
        },
      });

      const application = await tx.providerApplication.create({
        data: {
          npi: data.npi,
          firstName: data.firstName,
          lastName: data.lastName,
          middleName: data.middleName,
          suffix: data.suffix,
          email: data.email,
          phone: data.phone,
          dateOfBirth: new Date(data.dateOfBirth),
          gender: data.gender as any,
          providerType: data.providerType,
          taxonomy: data.taxonomy,
          specialties: data.specialties || [],
          ...(data.caqhProviderId && { caqhProviderId: data.caqhProviderId }),
          status: 'pending',
          providerId: provider.id,
        },
      });

      return { provider, application, newUser };
    });

    // 7. Create admin notification
    await prisma.adminNotification.create({
      data: {
        type: 'NEW_APPLICATION',
        message: `New self-serve provider signup: ${data.firstName} ${data.lastName}`,
        applicationId: application.id,
      },
    });

    // 8. Notify admin users (non-blocking)
    notificationService.notifyAdminUsers({
      type: 'new_application',
      title: 'New Self-Serve Provider Signup',
      message: `${data.firstName} ${data.lastName} (NPI: ${data.npi}) signed up for instant access.`,
      actionUrl: '/pending-providers',
      metadata: { applicationId: application.id, npi: data.npi },
    }).catch((err: unknown) => logger.error('Failed to create in-app notifications:', err));

    // 9. Send welcome email (non-blocking)
    if (emailService.isConfigured()) {
      const appUrl = process.env['APP_URL'] || 'http://localhost:5190';
      emailService.sendEmail({
        to: data.email,
        subject: 'Welcome to Lanyard Health',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #0A3D2E;">Welcome to Lanyard Health!</h2>
            <p>Dear ${data.firstName},</p>
            <p>Your account has been created and you can start setting up your provider profile immediately.</p>

            <div style="background-color: #fffbeb; border: 1px solid #fcd34d; border-radius: 8px; padding: 16px; margin: 20px 0;">
              <h3 style="margin-top: 0; color: #92400e;">Account Verification</h3>
              <p style="margin-bottom: 0; color: #78350f;">Your account is being reviewed by our team. You can start setting up your profile now. Enrollment features will be available once your account is verified.</p>
            </div>

            <p>
              <a href="${appUrl}/login" style="background-color: #0A3D2E; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">
                Log In Now
              </a>
            </p>

            <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;" />
            <p style="color: #6b7280; font-size: 12px;">
              This is an automated notification from Lanyard Health. Please do not reply to this email.
            </p>
          </div>
        `,
        notificationType: 'application_submitted',
      }).catch((err: unknown) => logger.error('Failed to send welcome email:', err));
    }

    return { userId: newUser.id, providerId: provider.id, email: newUser.email };
  } catch (err: any) {
    // 10. Roll back Cognito user on any failure
    await deleteCognitoUser(data.email).catch(() => {});
    if (err?.code === 'P2002') {
      throw new Error('An account with this email address already exists');
    }
    throw err;
  }
}

/**
 * Get application status by NPI
 */
export async function getApplicationStatusByNpi(npi: string) {
  return prisma.providerApplication.findFirst({
    where: { npi },
    orderBy: { submittedAt: 'desc' },
    select: {
      id: true,
      status: true,
      submittedAt: true,
      reviewedAt: true,
      reviewNotes: true,
    },
  });
}

/**
 * Get all applications with optional status filter
 */
export async function getApplications(status?: 'pending' | 'approved' | 'rejected') {
  return prisma.providerApplication.findMany({
    where: status ? { status } : undefined,
    orderBy: { submittedAt: 'desc' },
  });
}

/**
 * Get single application by ID
 */
export async function getApplicationById(id: string) {
  return prisma.providerApplication.findUnique({
    where: { id },
  });
}

/**
 * Approve an application — creates Cognito user, Provider record, and User record
 */
export async function approveApplication(id: string, reviewedBy: string, notes?: string) {
  const application = await prisma.providerApplication.findUnique({
    where: { id },
  });

  if (!application) {
    throw new Error('Application not found');
  }

  if (application.status !== 'pending') {
    throw new Error('Application has already been reviewed');
  }

  // Self-serve path: provider already has a User + Provider record (created during selfServeSignup)
  if (application.providerId) {
    const updatedApplication = await prisma.$transaction(async (tx) => {
      await tx.providerProfile.update({
        where: { id: application.providerId! },
        data: { status: 'active' },
      });

      return tx.providerApplication.update({
        where: { id },
        data: {
          status: 'approved',
          reviewedAt: new Date(),
          reviewedBy,
          reviewNotes: notes,
        },
      });
    });

    // CAQH-first onboarding: the self-serve provider row already carries the CAQH ID
    // (set at signup) — start the background import now that they're verified.
    const verifiedProvider = await prisma.providerProfile.findUnique({
      where: { id: application.providerId },
      select: { caqhProviderId: true },
    });
    if (verifiedProvider?.caqhProviderId) {
      enqueueCaqhImport({ providerId: application.providerId, trigger: 'approval' }).catch(
        (err: unknown) => logger.error('Failed to enqueue CAQH import after verification:', err)
      );
    }

    // Mark related notification as read
    await prisma.adminNotification.updateMany({
      where: { applicationId: id, read: false },
      data: { read: true },
    });

    // Find the user linked to this provider and send in-app notification
    const providerUser = await prisma.user.findFirst({
      where: { providerId: application.providerId },
      select: { id: true },
    });
    if (providerUser) {
      notificationService.createNotification({
        userId: providerUser.id,
        type: 'application_approved',
        title: 'Account Verified',
        message: 'Your account has been verified. All features are now available.',
        actionUrl: '/portal',
      }).catch((err: unknown) => logger.error('Failed to create verification notification:', err));
    }

    // Send "verified" email (no temp password mention)
    if (emailService.isConfigured()) {
      const appUrl = process.env['APP_URL'] || 'http://localhost:5190';
      emailService.sendEmail({
        to: application.email,
        subject: 'Account Verified — Lanyard Health',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #0A3D2E;">Your Account Has Been Verified!</h2>
            <p>Dear ${application.firstName},</p>
            <p>Your Lanyard Health account has been verified by our team. All features, including enrollment management, are now available.</p>

            <p>
              <a href="${appUrl}/portal" style="background-color: #0A3D2E; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">
                Go to Your Dashboard
              </a>
            </p>

            <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;" />
            <p style="color: #6b7280; font-size: 12px;">
              This is an automated notification from Lanyard Health. Please do not reply to this email.
            </p>
          </div>
        `,
        notificationType: 'application_approved',
      }).catch((err: unknown) => logger.error('Failed to send verification email:', err));
    }

    return updatedApplication;
  }

  // Traditional path: create Cognito user + Provider + User from scratch
  // Pre-check: ensure no user with this email exists (could have been created since submission)
  const existingUser = await prisma.user.findUnique({ where: { email: application.email } });
  if (existingUser) {
    throw new Error('An account with this email address already exists');
  }

  // Re-check CAQH ID availability — it could have been claimed between submission and approval
  if (application.caqhProviderId) {
    const caqhConflict = await prismaBase.providerProfile.findFirst({
      where: { caqhProviderId: application.caqhProviderId },
      select: { id: true },
    });
    if (caqhConflict) {
      throw new Error(
        `This application's CAQH Provider ID is already linked to another provider. ` +
          `Correct the CAQH ID on the existing provider record, then approve again.`
      );
    }
  }

  // 1. Create Cognito user first (outside transaction — can't roll back Cognito)
  const { cognitoId } = await createCognitoUser({
    email: application.email,
    firstName: application.firstName,
    lastName: application.lastName,
  });

  // 2. Create Provider + User records in a transaction
  try {
    const { provider, updatedApplication, newUser } = await prisma.$transaction(async (tx) => {
      const provider = await tx.providerProfile.create({
        data: {
          npi: application.npi,
          firstName: application.firstName,
          lastName: application.lastName,
          middleName: application.middleName,
          suffix: application.suffix,
          email: application.email,
          phone: application.phone,
          dateOfBirth: application.dateOfBirth,
          gender: application.gender,
          providerType: (application.providerType as any) || 'other',
          taxonomy: application.taxonomy,
          specialties: application.specialties,
          status: 'active',
          ...(application.caqhProviderId && { caqhProviderId: application.caqhProviderId }),
          ...(application.practiceId && { practiceId: application.practiceId }),
        },
      });

      const newUser = await tx.user.create({
        data: {
          cognitoId,
          email: application.email,
          firstName: application.firstName,
          lastName: application.lastName,
          phone: application.phone,
          role: 'provider',
          providerId: provider.id,
        },
      });

      // Auto-assign to practice if application came from a practice link
      if (application.practiceId) {
        await tx.userPractice.create({
          data: {
            userId: newUser.id,
            practiceId: application.practiceId,
            role: 'PROVIDER',
          },
        });
      }

      const updatedApplication = await tx.providerApplication.update({
        where: { id },
        data: {
          status: 'approved',
          reviewedAt: new Date(),
          reviewedBy,
          reviewNotes: notes,
          providerId: provider.id,
        },
      });

      return { provider, updatedApplication, newUser };
    });

    // CAQH-first onboarding: kick off the background profile import now that the
    // provider exists. Fire-and-forget — approval must not fail on queue trouble.
    if (provider.caqhProviderId) {
      enqueueCaqhImport({ providerId: provider.id, trigger: 'approval' }).catch((err: unknown) =>
        logger.error('Failed to enqueue CAQH import after approval:', err)
      );
    }

    // Mark related notification as read
    await prisma.adminNotification.updateMany({
      where: { applicationId: id, read: false },
      data: { read: true },
    });

    // Notify provider their application was approved
    notificationService.createNotification({
      userId: newUser.id,
      type: 'application_approved',
      title: 'Application Approved',
      message: 'Your provider application has been approved. Welcome to Lanyard Health!',
      actionUrl: '/portal',
    }).catch((err: unknown) => logger.error('Failed to create approval notification:', err));

    // 3. Send approval email to provider (non-blocking)
    if (emailService.isConfigured()) {
      const appUrl = process.env['APP_URL'] || 'http://localhost:5190';
      emailService.sendEmail({
        to: application.email,
        subject: 'Application Approved — Lanyard Health',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #0A3D2E;">Your Application Has Been Approved!</h2>
            <p>Dear ${application.firstName},</p>
            <p>We are pleased to inform you that your provider application with Lanyard Health has been approved.</p>

            <div style="background-color: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 16px; margin: 20px 0;">
              <h3 style="margin-top: 0; color: #0A3D2E;">Getting Started</h3>
              <p>Your account has been created. You will receive a separate email with your temporary login credentials.</p>
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
      }).catch((err: unknown) => logger.error('Failed to send approval email:', err));
    }

    return updatedApplication;
  } catch (err: any) {
    // Roll back Cognito user if DB transaction failed
    await deleteCognitoUser(application.email).catch(() => {});
    // Surface a clear message for duplicate email race condition (P2002)
    if (err?.code === 'P2002') {
      throw new Error('An account with this email address already exists');
    }
    throw err;
  }
}

/**
 * Reject an application
 */
export async function rejectApplication(id: string, reviewedBy: string, notes: string) {
  const application = await prisma.providerApplication.findUnique({
    where: { id },
  });

  if (!application) {
    throw new Error('Application not found');
  }

  if (application.status !== 'pending') {
    throw new Error('Application has already been reviewed');
  }

  const updatedApplication = await prisma.providerApplication.update({
    where: { id },
    data: {
      status: 'rejected',
      reviewedAt: new Date(),
      reviewedBy,
      reviewNotes: notes,
    },
  });

  // Mark related notification as read
  await prisma.adminNotification.updateMany({
    where: { applicationId: id, read: false },
    data: { read: true },
  });

  // Send rejection email (non-blocking)
  if (emailService.isConfigured()) {
    const appUrl = process.env['APP_URL'] || 'http://localhost:5190';
    emailService.sendEmail({
      to: application.email,
      subject: 'Application Update — Lanyard Health',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #0A3D2E;">Application Update</h2>
          <p>Dear ${application.firstName},</p>
          <p>After reviewing your application, we are unable to approve it at this time.</p>
          ${notes ? `
          <div style="background-color: #fef3c7; border: 1px solid #fcd34d; border-radius: 8px; padding: 16px; margin: 20px 0;">
            <h3 style="margin-top: 0; color: #92400e; font-size: 14px;">Reviewer Notes</h3>
            <p style="margin-bottom: 0; color: #78350f; font-size: 14px;">${notes.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>
          </div>
          ` : ''}
          <p>If you believe this decision was made in error or if you have additional information to provide, you may submit a new application.</p>
          <p style="margin: 24px 0;">
            <a href="${appUrl}/register?reapply=${application.id}" style="background-color: #0A3D2E; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; display: inline-block; font-weight: 500;">
              Submit New Application
            </a>
          </p>
          <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;" />
          <p style="color: #6b7280; font-size: 12px;">
            This is an automated notification from Lanyard Health. Please do not reply to this email.
          </p>
        </div>
      `,
      notificationType: 'application_rejected' as any,
    }).catch((err: unknown) => logger.error('Failed to send rejection email:', err));
  }

  return updatedApplication;
}

/**
 * Get pending application count
 */
export async function getPendingApplicationCount(): Promise<number> {
  return prisma.providerApplication.count({
    where: { status: 'pending' },
  });
}

/**
 * Get unread admin notification count
 */
export async function getUnreadNotificationCount(): Promise<number> {
  return prisma.adminNotification.count({
    where: { read: false },
  });
}

/**
 * Get admin notifications
 */
export async function getAdminNotifications(unreadOnly = false) {
  return prisma.adminNotification.findMany({
    where: unreadOnly ? { read: false } : undefined,
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
}

/**
 * Mark notifications as read
 */
export async function markNotificationsAsRead(notificationIds?: string[]) {
  if (notificationIds && notificationIds.length > 0) {
    await prisma.adminNotification.updateMany({
      where: { id: { in: notificationIds } },
      data: { read: true },
    });
  } else {
    await prisma.adminNotification.updateMany({
      where: { read: false },
      data: { read: true },
    });
  }
}
