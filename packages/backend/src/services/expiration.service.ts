import { prisma } from '../utils/prisma.js';
import { logger } from '../utils/logger.js';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { EXPIRATION_THRESHOLDS } from '@credential-management/shared';

interface ExpiringCredential {
  id: string;
  type: 'license' | 'certification' | 'insurance' | 'document';
  name: string;
  expirationDate: Date;
  daysUntilExpiration: number;
  providerId: string;
  providerName: string;
  providerEmail: string;
}

interface DashboardData {
  expiring7Days: number;
  expiring30Days: number;
  expiring60Days: number;
  expiring90Days: number;
  expired: number;
  byType: Record<string, number>;
  recentExpirations: ExpiringCredential[];
}

export class ExpirationService {
  private ses: SESClient;
  private fromEmail: string;

  constructor() {
    this.ses = new SESClient({
      region: process.env['AWS_REGION'] || 'us-east-1',
    });
    this.fromEmail = process.env['SES_FROM_EMAIL'] || 'noreply@credentials.com';
  }

  async getUpcomingExpirations(
    days: number = 30,
    type?: string
  ): Promise<ExpiringCredential[]> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() + days);

    const expirations: ExpiringCredential[] = [];

    // Get expiring licenses
    if (!type || type === 'license') {
      const licenses = await prisma.license.findMany({
        where: {
          expirationDate: {
            lte: cutoffDate,
            gte: new Date(),
          },
          status: 'active',
        },
        include: {
          provider: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
            },
          },
        },
      });

      expirations.push(
        ...licenses.map(license => ({
          id: license.id,
          type: 'license' as const,
          name: `${license.licenseType} - ${license.licenseNumber}`,
          expirationDate: license.expirationDate,
          daysUntilExpiration: this.getDaysUntil(license.expirationDate),
          providerId: license.provider.id,
          providerName: `${license.provider.firstName} ${license.provider.lastName}`,
          providerEmail: license.provider.email,
        }))
      );
    }

    // Get expiring board certifications
    if (!type || type === 'certification') {
      const certifications = await prisma.boardCertification.findMany({
        where: {
          expirationDate: {
            lte: cutoffDate,
            gte: new Date(),
          },
          status: 'active',
        },
        include: {
          provider: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
            },
          },
        },
      });

      expirations.push(
        ...certifications.map(cert => ({
          id: cert.id,
          type: 'certification' as const,
          name: `${cert.boardName} - ${cert.specialty}`,
          expirationDate: cert.expirationDate!,
          daysUntilExpiration: this.getDaysUntil(cert.expirationDate!),
          providerId: cert.provider.id,
          providerName: `${cert.provider.firstName} ${cert.provider.lastName}`,
          providerEmail: cert.provider.email,
        }))
      );
    }

    // Get expiring malpractice insurance
    if (!type || type === 'insurance') {
      const insurances = await prisma.malpracticeInsurance.findMany({
        where: {
          expirationDate: {
            lte: cutoffDate,
            gte: new Date(),
          },
          status: 'active',
        },
        include: {
          provider: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
            },
          },
        },
      });

      expirations.push(
        ...insurances.map(insurance => ({
          id: insurance.id,
          type: 'insurance' as const,
          name: `${insurance.carrierName} - ${insurance.policyNumber}`,
          expirationDate: insurance.expirationDate,
          daysUntilExpiration: this.getDaysUntil(insurance.expirationDate),
          providerId: insurance.provider.id,
          providerName: `${insurance.provider.firstName} ${insurance.provider.lastName}`,
          providerEmail: insurance.provider.email,
        }))
      );
    }

    // Get expiring documents
    if (!type || type === 'document') {
      const documents = await prisma.document.findMany({
        where: {
          expirationDate: {
            lte: cutoffDate,
            gte: new Date(),
          },
        },
        include: {
          provider: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
            },
          },
        },
      });

      expirations.push(
        ...documents.map(doc => ({
          id: doc.id,
          type: 'document' as const,
          name: `${doc.documentType} - ${doc.originalFileName}`,
          expirationDate: doc.expirationDate!,
          daysUntilExpiration: this.getDaysUntil(doc.expirationDate!),
          providerId: doc.provider.id,
          providerName: `${doc.provider.firstName} ${doc.provider.lastName}`,
          providerEmail: doc.provider.email,
        }))
      );
    }

    // Sort by expiration date
    return expirations.sort(
      (a, b) => a.expirationDate.getTime() - b.expirationDate.getTime()
    );
  }

  async getDashboardData(): Promise<DashboardData> {
    const now = new Date();
    const in7Days = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const in30Days = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    const in60Days = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000);
    const in90Days = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);

    // Count expiring items by timeframe
    const [
      licenses7,
      licenses30,
      licenses60,
      licenses90,
      licensesExpired,
    ] = await Promise.all([
      prisma.license.count({ where: { expirationDate: { lte: in7Days, gte: now }, status: 'active' } }),
      prisma.license.count({ where: { expirationDate: { lte: in30Days, gte: now }, status: 'active' } }),
      prisma.license.count({ where: { expirationDate: { lte: in60Days, gte: now }, status: 'active' } }),
      prisma.license.count({ where: { expirationDate: { lte: in90Days, gte: now }, status: 'active' } }),
      prisma.license.count({ where: { expirationDate: { lt: now }, status: 'active' } }),
    ]);

    const [
      certs7,
      certs30,
      certs60,
      certs90,
      certsExpired,
    ] = await Promise.all([
      prisma.boardCertification.count({ where: { expirationDate: { lte: in7Days, gte: now }, status: 'active' } }),
      prisma.boardCertification.count({ where: { expirationDate: { lte: in30Days, gte: now }, status: 'active' } }),
      prisma.boardCertification.count({ where: { expirationDate: { lte: in60Days, gte: now }, status: 'active' } }),
      prisma.boardCertification.count({ where: { expirationDate: { lte: in90Days, gte: now }, status: 'active' } }),
      prisma.boardCertification.count({ where: { expirationDate: { lt: now }, status: 'active' } }),
    ]);

    const [
      insurance7,
      insurance30,
      insurance60,
      insurance90,
      insuranceExpired,
    ] = await Promise.all([
      prisma.malpracticeInsurance.count({ where: { expirationDate: { lte: in7Days, gte: now }, status: 'active' } }),
      prisma.malpracticeInsurance.count({ where: { expirationDate: { lte: in30Days, gte: now }, status: 'active' } }),
      prisma.malpracticeInsurance.count({ where: { expirationDate: { lte: in60Days, gte: now }, status: 'active' } }),
      prisma.malpracticeInsurance.count({ where: { expirationDate: { lte: in90Days, gte: now }, status: 'active' } }),
      prisma.malpracticeInsurance.count({ where: { expirationDate: { lt: now }, status: 'active' } }),
    ]);

    const recentExpirations = await this.getUpcomingExpirations(30);

    return {
      expiring7Days: licenses7 + certs7 + insurance7,
      expiring30Days: licenses30 + certs30 + insurance30,
      expiring60Days: licenses60 + certs60 + insurance60,
      expiring90Days: licenses90 + certs90 + insurance90,
      expired: licensesExpired + certsExpired + insuranceExpired,
      byType: {
        licenses: licenses30,
        certifications: certs30,
        insurance: insurance30,
      },
      recentExpirations: recentExpirations.slice(0, 10),
    };
  }

  async getProviderExpirations(providerId: string): Promise<ExpiringCredential[]> {
    const expirations = await this.getUpcomingExpirations(365);
    return expirations.filter(e => e.providerId === providerId);
  }

  async sendExpirationReminders(
    thresholds: readonly number[] = EXPIRATION_THRESHOLDS
  ): Promise<{ sent: number; failed: number }> {
    let sent = 0;
    let failed = 0;

    for (const days of thresholds) {
      const expirations = await this.getExpiringOnDay(days);

      for (const expiration of expirations) {
        try {
          await this.sendReminderEmail(expiration, days);
          sent++;

          // Log notification
          await prisma.notification.create({
            data: {
              recipientEmail: expiration.providerEmail,
              type: 'expiration_reminder',
              subject: `Credential Expiring in ${days} Days`,
              body: this.getEmailBody(expiration, days),
              status: 'sent',
              sentAt: new Date(),
              metadata: {
                credentialId: expiration.id,
                credentialType: expiration.type,
                daysUntilExpiration: days,
              },
            },
          });
        } catch (error) {
          logger.error(`Failed to send reminder for ${expiration.id}`, error);
          failed++;

          await prisma.notification.create({
            data: {
              recipientEmail: expiration.providerEmail,
              type: 'expiration_reminder',
              subject: `Credential Expiring in ${days} Days`,
              body: this.getEmailBody(expiration, days),
              status: 'failed',
              errorMessage: error instanceof Error ? error.message : 'Unknown error',
              metadata: {
                credentialId: expiration.id,
                credentialType: expiration.type,
              },
            },
          });
        }
      }
    }

    return { sent, failed };
  }

  private async getExpiringOnDay(daysFromNow: number): Promise<ExpiringCredential[]> {
    const targetDate = new Date();
    targetDate.setDate(targetDate.getDate() + daysFromNow);
    targetDate.setHours(0, 0, 0, 0);

    const nextDay = new Date(targetDate);
    nextDay.setDate(nextDay.getDate() + 1);

    const allExpirations = await this.getUpcomingExpirations(daysFromNow + 1);

    return allExpirations.filter(e => {
      const expDate = new Date(e.expirationDate);
      expDate.setHours(0, 0, 0, 0);
      return expDate.getTime() === targetDate.getTime();
    });
  }

  private async sendReminderEmail(
    expiration: ExpiringCredential,
    daysUntilExpiration: number
  ): Promise<void> {
    const command = new SendEmailCommand({
      Source: this.fromEmail,
      Destination: {
        ToAddresses: [expiration.providerEmail],
      },
      Message: {
        Subject: {
          Data: `Action Required: ${expiration.name} Expires in ${daysUntilExpiration} Days`,
        },
        Body: {
          Html: {
            Data: this.getEmailBody(expiration, daysUntilExpiration),
          },
        },
      },
    });

    await this.ses.send(command);
  }

  private getEmailBody(
    expiration: ExpiringCredential,
    daysUntilExpiration: number
  ): string {
    return `
      <html>
        <body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #d97706;">Credential Expiration Reminder</h2>

          <p>Dear ${expiration.providerName},</p>

          <p>This is a reminder that the following credential will expire in <strong>${daysUntilExpiration} days</strong>:</p>

          <div style="background-color: #fef3c7; padding: 16px; border-radius: 8px; margin: 16px 0;">
            <p style="margin: 0;"><strong>Type:</strong> ${expiration.type}</p>
            <p style="margin: 8px 0 0;"><strong>Name:</strong> ${expiration.name}</p>
            <p style="margin: 8px 0 0;"><strong>Expiration Date:</strong> ${expiration.expirationDate.toLocaleDateString()}</p>
          </div>

          <p>Please take action to renew this credential before it expires to avoid any disruption to your practice.</p>

          <p>Once renewed, please upload the updated documentation to your provider portal.</p>

          <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;" />

          <p style="color: #6b7280; font-size: 12px;">
            This is an automated message from the Credentials Management System.
            Please do not reply to this email.
          </p>
        </body>
      </html>
    `;
  }

  private getDaysUntil(date: Date): number {
    const now = new Date();
    const diffTime = date.getTime() - now.getTime();
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  }
}
