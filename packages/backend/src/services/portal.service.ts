import { PrismaClient } from '@prisma/client';
import { emailService } from './email.service.js';

const prisma = new PrismaClient();

export interface ProviderApplicationInput {
  npi: string;
  firstName: string;
  lastName: string;
  middleName?: string;
  suffix?: string;
  email: string;
  phone: string;
  providerType?: string;
  taxonomy?: string;
  specialties?: string[];
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
      providerType: data.providerType,
      taxonomy: data.taxonomy,
      specialties: data.specialties || [],
    },
  });

  // Create in-app notification
  await prisma.adminNotification.create({
    data: {
      type: 'NEW_APPLICATION',
      message: `New provider application from ${data.firstName} ${data.lastName}`,
      applicationId: application.id,
    },
  });

  // Send email notification (non-blocking)
  const adminEmail = process.env['ADMIN_EMAIL'];
  if (adminEmail && emailService.isConfigured()) {
    const appUrl = process.env['APP_URL'] || 'http://localhost:5173';
    emailService.sendEmail({
      to: adminEmail,
      subject: `New Provider Application: ${data.firstName} ${data.lastName}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #2563eb;">New Provider Application</h2>
          <p>A new provider has submitted an application for review.</p>

          <h3>Provider Details</h3>
          <ul>
            <li><strong>Name:</strong> ${data.firstName} ${data.lastName}</li>
            <li><strong>NPI:</strong> ${data.npi}</li>
            <li><strong>Email:</strong> ${data.email}</li>
            <li><strong>Phone:</strong> ${data.phone}</li>
          </ul>

          <p>
            <a href="${appUrl}/pending-providers" style="background-color: #2563eb; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">
              Review Application
            </a>
          </p>

          <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;" />
          <p style="color: #6b7280; font-size: 12px;">
            This is an automated notification from the Credentialing system.
          </p>
        </div>
      `,
    }).catch((err: unknown) => console.error('Failed to send application notification email:', err));
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
 * Approve an application
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

  // Update the application status
  const updatedApplication = await prisma.providerApplication.update({
    where: { id },
    data: {
      status: 'approved',
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
