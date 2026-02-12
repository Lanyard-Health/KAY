import { PrismaClient } from '@prisma/client';
import { emailService } from './email.service.js';
import { createCognitoUser, deleteCognitoUser } from './cognitoUser.service.js';
import { notificationService } from './notification.service.js';

const prisma = new PrismaClient();

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
  practiceId?: string;
}

/**
 * Check if an application with this NPI already exists
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
 * Check if a provider with this NPI already exists
 */
export async function checkExistingProvider(npi: string) {
  return prisma.provider.findUnique({
    where: { npi },
    select: { id: true, npi: true },
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
      ...(data.practiceId && { practiceId: data.practiceId }),
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
  }).catch((err: unknown) => console.error('Failed to create in-app notifications:', err));

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
    }).catch((err: unknown) => console.error('Failed to send admin notification email:', err));
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
    }).catch((err: unknown) => console.error('Failed to send provider confirmation email:', err));
  }

  return application;
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

  // 1. Create Cognito user first (outside transaction — can't roll back Cognito)
  const { cognitoId } = await createCognitoUser({
    email: application.email,
    firstName: application.firstName,
    lastName: application.lastName,
  });

  // 2. Create Provider + User records in a transaction
  try {
    const { provider, updatedApplication, newUser } = await prisma.$transaction(async (tx) => {
      const provider = await tx.provider.create({
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
    }).catch((err: unknown) => console.error('Failed to create approval notification:', err));

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
      }).catch((err: unknown) => console.error('Failed to send approval email:', err));
    }

    return updatedApplication;
  } catch (err) {
    // Roll back Cognito user if DB transaction failed
    await deleteCognitoUser(application.email).catch(() => {});
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
