import type { Enrollment, ProviderProfile, Payer, PracticeLocation } from '@prisma/client';
import { emailService } from './email.service.js';
import { prisma } from '../utils/prisma.js';

type ProviderWithLocations = ProviderProfile & {
  practiceLocations: PracticeLocation[];
};

type EnrollmentWithRelations = Enrollment & {
  provider: ProviderWithLocations;
  payer: Payer;
};

interface FollowUpResult {
  enrollmentId: string;
  providerName: string;
  payerName: string;
  email: string;
  success: boolean;
  error?: string;
}

interface FollowUpEmailData {
  providerName: string;
  providerNpi: string;
  groupNpi: string;
  practiceName: string;
  practiceCity: string;
  practiceState: string;
  payerName: string;
  customMessage?: string;
}

class FollowUpService {
  /**
   * Get all enrollments that need follow-up today
   */
  async getEnrollmentsDueForFollowUp(): Promise<EnrollmentWithRelations[]> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    return prisma.enrollment.findMany({
      where: {
        followUpEnabled: true,
        followUpEmail: { not: null },
        status: {
          notIn: ['approved', 'denied', 'terminated'],
        },
        OR: [
          // Next follow-up date is today or earlier
          { nextFollowUpDate: { lte: tomorrow } },
          // Or no next follow-up date set yet (first time)
          { nextFollowUpDate: null },
        ],
      },
      include: {
        provider: {
          include: {
            practiceLocations: true,
          },
        },
        payer: true,
      },
    });
  }

  /**
   * Extract provider data for email template
   */
  extractProviderData(enrollment: EnrollmentWithRelations): FollowUpEmailData {
    const provider = enrollment.provider;
    const primaryLocation = provider.practiceLocations?.find((loc) => loc.isPrimary)
      || provider.practiceLocations?.[0];

    return {
      providerName: `${provider.firstName} ${provider.lastName}`,
      providerNpi: provider.npi,
      groupNpi: primaryLocation?.npi || '',
      practiceName: primaryLocation?.locationName || '',
      practiceCity: primaryLocation?.city || '',
      practiceState: primaryLocation?.state || '',
      payerName: enrollment.payer.name,
    };
  }

  /**
   * Generate professional follow-up email template
   */
  generateProfessionalEmail(data: FollowUpEmailData, customMessage?: string): string {
    return `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #ffffff;">
        <div style="background: #1e40af; padding: 24px; text-align: center;">
          <h1 style="color: #ffffff; margin: 0; font-size: 20px; font-weight: 600;">
            Provider Enrollment Follow-Up
          </h1>
        </div>

        <div style="padding: 32px 24px;">
          <p style="color: #374151; font-size: 15px; line-height: 1.6; margin: 0 0 24px 0;">
            Hello,
          </p>

          <p style="color: #374151; font-size: 15px; line-height: 1.6; margin: 0 0 24px 0;">
            We are following up on the credentialing application for the following provider:
          </p>

          <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 20px; margin-bottom: 24px;">
            <table style="width: 100%; border-collapse: collapse;">
              <tr>
                <td style="padding: 8px 0; color: #64748b; font-size: 13px; width: 140px;">Provider Name</td>
                <td style="padding: 8px 0; color: #1e293b; font-size: 14px; font-weight: 600;">${data.providerName}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #64748b; font-size: 13px;">Provider NPI</td>
                <td style="padding: 8px 0; color: #1e293b; font-size: 14px; font-weight: 600;">${data.providerNpi}</td>
              </tr>
              ${data.groupNpi ? `
              <tr>
                <td style="padding: 8px 0; color: #64748b; font-size: 13px;">Group NPI</td>
                <td style="padding: 8px 0; color: #1e293b; font-size: 14px; font-weight: 600;">${data.groupNpi}</td>
              </tr>
              ` : ''}
              ${data.practiceName ? `
              <tr>
                <td style="padding: 8px 0; color: #64748b; font-size: 13px;">Practice Name</td>
                <td style="padding: 8px 0; color: #1e293b; font-size: 14px; font-weight: 600;">${data.practiceName}</td>
              </tr>
              ` : ''}
              ${data.practiceCity && data.practiceState ? `
              <tr>
                <td style="padding: 8px 0; color: #64748b; font-size: 13px;">Location</td>
                <td style="padding: 8px 0; color: #1e293b; font-size: 14px; font-weight: 600;">${data.practiceCity}, ${data.practiceState}</td>
              </tr>
              ` : ''}
              <tr>
                <td style="padding: 8px 0; color: #64748b; font-size: 13px;">Payer</td>
                <td style="padding: 8px 0; color: #1e293b; font-size: 14px; font-weight: 600;">${data.payerName}</td>
              </tr>
            </table>
          </div>

          ${customMessage ? `
          <div style="background: #fffbeb; border: 1px solid #fcd34d; border-radius: 8px; padding: 16px; margin-bottom: 24px;">
            <p style="color: #92400e; font-size: 14px; line-height: 1.6; margin: 0;">
              ${customMessage}
            </p>
          </div>
          ` : ''}

          <p style="color: #374151; font-size: 15px; line-height: 1.6; margin: 0 0 24px 0;">
            Could you please provide an update on the status of this application? If any additional information is needed, please let us know.
          </p>

          <p style="color: #374151; font-size: 15px; line-height: 1.6; margin: 0;">
            Thank you for your assistance.
          </p>
        </div>

        <div style="background: #f8fafc; padding: 20px 24px; border-top: 1px solid #e2e8f0;">
          <p style="color: #64748b; font-size: 12px; margin: 0; text-align: center;">
            This email was sent from the Lanyard Health Credentialing System
          </p>
        </div>
      </div>
    `;
  }

  /**
   * Generate the HTML email content for a follow-up
   */
  generateFollowUpEmail(enrollment: EnrollmentWithRelations): string {
    const statusLabels: Record<string, string> = {
      not_started: 'Not Started',
      in_progress: 'In Progress',
      submitted: 'Submitted',
      pending_review: 'Pending Review',
    };

    const statusColors: Record<string, string> = {
      not_started: '#6b7280',
      in_progress: '#f59e0b',
      submitted: '#3b82f6',
      pending_review: '#8b5cf6',
    };

    const status = statusLabels[enrollment.status] || enrollment.status;
    const statusColor = statusColors[enrollment.status] || '#6b7280';

    const applicationDate = enrollment.applicationDate
      ? new Date(enrollment.applicationDate).toLocaleDateString()
      : 'Not submitted';

    const lastFollowUp = enrollment.lastFollowUpDate
      ? new Date(enrollment.lastFollowUpDate).toLocaleDateString()
      : 'Never';

    const daysSinceLastFollowUp = enrollment.lastFollowUpDate
      ? Math.floor((Date.now() - new Date(enrollment.lastFollowUpDate).getTime()) / (1000 * 60 * 60 * 24))
      : null;

    return `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #ffffff;">
        <div style="background: linear-gradient(to right, #2563eb, #3b82f6); padding: 20px; text-align: center;">
          <h1 style="color: #ffffff; margin: 0; font-size: 24px;">Enrollment Follow-Up Reminder</h1>
        </div>

        <div style="padding: 30px;">
          <p style="color: #374151; font-size: 16px; margin-bottom: 20px;">
            This is an automated reminder to follow up on the following payer enrollment:
          </p>

          <div style="background: #f9fafb; border-radius: 8px; padding: 20px; margin-bottom: 20px;">
            <h2 style="color: #1f2937; margin: 0 0 15px 0; font-size: 18px;">
              ${enrollment.provider.firstName} ${enrollment.provider.lastName}
            </h2>
            <p style="color: #6b7280; margin: 0 0 5px 0; font-size: 14px;">
              NPI: ${enrollment.provider.npi}
            </p>
          </div>

          <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
            <tr>
              <td style="padding: 12px; border-bottom: 1px solid #e5e7eb; color: #6b7280; font-size: 14px;">
                Payer
              </td>
              <td style="padding: 12px; border-bottom: 1px solid #e5e7eb; color: #1f2937; font-size: 14px; font-weight: 500;">
                ${enrollment.payer.name}
              </td>
            </tr>
            <tr>
              <td style="padding: 12px; border-bottom: 1px solid #e5e7eb; color: #6b7280; font-size: 14px;">
                Status
              </td>
              <td style="padding: 12px; border-bottom: 1px solid #e5e7eb;">
                <span style="display: inline-block; padding: 4px 12px; background: ${statusColor}20; color: ${statusColor}; border-radius: 9999px; font-size: 13px; font-weight: 500;">
                  ${status}
                </span>
              </td>
            </tr>
            <tr>
              <td style="padding: 12px; border-bottom: 1px solid #e5e7eb; color: #6b7280; font-size: 14px;">
                Application Date
              </td>
              <td style="padding: 12px; border-bottom: 1px solid #e5e7eb; color: #1f2937; font-size: 14px;">
                ${applicationDate}
              </td>
            </tr>
            <tr>
              <td style="padding: 12px; border-bottom: 1px solid #e5e7eb; color: #6b7280; font-size: 14px;">
                Last Follow-Up
              </td>
              <td style="padding: 12px; border-bottom: 1px solid #e5e7eb; color: #1f2937; font-size: 14px;">
                ${lastFollowUp}
                ${daysSinceLastFollowUp !== null ? `<span style="color: #f59e0b;"> (${daysSinceLastFollowUp} days ago)</span>` : ''}
              </td>
            </tr>
            ${enrollment.providerNumber ? `
            <tr>
              <td style="padding: 12px; border-bottom: 1px solid #e5e7eb; color: #6b7280; font-size: 14px;">
                Provider #
              </td>
              <td style="padding: 12px; border-bottom: 1px solid #e5e7eb; color: #1f2937; font-size: 14px;">
                ${enrollment.providerNumber}
              </td>
            </tr>
            ` : ''}
            ${enrollment.productTypes && enrollment.productTypes.length > 0 ? `
            <tr>
              <td style="padding: 12px; border-bottom: 1px solid #e5e7eb; color: #6b7280; font-size: 14px;">
                Product Types
              </td>
              <td style="padding: 12px; border-bottom: 1px solid #e5e7eb; color: #1f2937; font-size: 14px;">
                ${enrollment.productTypes.join(', ')}
              </td>
            </tr>
            ` : ''}
          </table>

          ${enrollment.notes ? `
          <div style="background: #fef3c7; border-radius: 8px; padding: 15px; margin-bottom: 20px;">
            <p style="color: #92400e; margin: 0; font-size: 14px;">
              <strong>Notes:</strong> ${enrollment.notes}
            </p>
          </div>
          ` : ''}

          <div style="background: #eff6ff; border-radius: 8px; padding: 15px;">
            <p style="color: #1e40af; margin: 0; font-size: 14px;">
              <strong>Recommended Action:</strong> Contact the payer to check on the status of this enrollment application.
            </p>
          </div>
        </div>

        <div style="background: #f9fafb; padding: 20px; text-align: center; border-top: 1px solid #e5e7eb;">
          <p style="color: #6b7280; font-size: 12px; margin: 0;">
            This is an automated email from the KAY Healthcare Credentialing System.
            <br />
            Next follow-up reminder scheduled in ${enrollment.followUpFrequencyDays} days.
          </p>
        </div>
      </div>
    `;
  }

  /**
   * Send a follow-up email for a specific enrollment
   */
  async sendFollowUpEmail(enrollment: EnrollmentWithRelations): Promise<FollowUpResult> {
    const result: FollowUpResult = {
      enrollmentId: enrollment.id,
      providerName: `${enrollment.provider.firstName} ${enrollment.provider.lastName}`,
      payerName: enrollment.payer.name,
      email: enrollment.followUpEmail || '',
      success: false,
    };

    if (!enrollment.followUpEmail) {
      result.error = 'No follow-up email configured';
      return result;
    }

    const html = this.generateFollowUpEmail(enrollment);
    const subject = `Follow-Up Reminder: ${enrollment.provider.lastName}, ${enrollment.provider.firstName} - ${enrollment.payer.name}`;

    const emailResult = await emailService.sendEmail({
      to: enrollment.followUpEmail,
      subject,
      html,
    });

    if (emailResult.success) {
      // Update enrollment with new follow-up dates
      const nextFollowUpDate = new Date();
      nextFollowUpDate.setDate(nextFollowUpDate.getDate() + enrollment.followUpFrequencyDays);

      await prisma.enrollment.update({
        where: { id: enrollment.id },
        data: {
          lastFollowUpSentAt: new Date(),
          nextFollowUpDate,
          lastFollowUpDate: new Date(), // Also update the manual follow-up date
        },
      });

      result.success = true;
    } else {
      result.error = emailResult.error;
    }

    return result;
  }

  /**
   * Process all due follow-ups
   */
  async processAllDueFollowUps(): Promise<{
    processed: number;
    successful: number;
    failed: number;
    results: FollowUpResult[];
  }> {
    const enrollments = await this.getEnrollmentsDueForFollowUp();
    const results: FollowUpResult[] = [];

    for (const enrollment of enrollments) {
      const result = await this.sendFollowUpEmail(enrollment);
      results.push(result);
    }

    return {
      processed: results.length,
      successful: results.filter((r) => r.success).length,
      failed: results.filter((r) => !r.success).length,
      results,
    };
  }

  /**
   * Send a follow-up email for a specific enrollment with custom message and attachment
   */
  async sendCustomFollowUp(
    enrollmentId: string,
    toEmail: string,
    options?: {
      customMessage?: string;
      attachment?: {
        filename: string;
        content: Buffer;
        contentType: string;
      };
    }
  ): Promise<FollowUpResult> {
    const enrollment = await prisma.enrollment.findUnique({
      where: { id: enrollmentId },
      include: {
        provider: {
          include: {
            practiceLocations: true,
          },
        },
        payer: true,
      },
    });

    if (!enrollment) {
      return {
        enrollmentId,
        providerName: 'Unknown',
        payerName: 'Unknown',
        email: toEmail,
        success: false,
        error: 'Enrollment not found',
      };
    }

    if (!toEmail) {
      return {
        enrollmentId,
        providerName: `${enrollment.provider.firstName} ${enrollment.provider.lastName}`,
        payerName: enrollment.payer.name,
        email: '',
        success: false,
        error: 'No email address provided',
      };
    }

    // Extract provider data for the template
    const providerData = this.extractProviderData(enrollment as EnrollmentWithRelations);
    const html = this.generateProfessionalEmail(providerData, options?.customMessage);
    const subject = `Credentialing Status Inquiry - ${providerData.providerName} - ${providerData.payerName}`;

    const emailResult = await emailService.sendEmail({
      to: toEmail,
      subject,
      html,
      attachments: options?.attachment ? [{
        filename: options.attachment.filename,
        content: options.attachment.content,
        contentType: options.attachment.contentType,
      }] : undefined,
    });

    // Update last follow-up date if successful
    if (emailResult.success) {
      await prisma.enrollment.update({
        where: { id: enrollmentId },
        data: {
          lastFollowUpSentAt: new Date(),
          lastFollowUpDate: new Date(),
        },
      });
    }

    return {
      enrollmentId,
      providerName: providerData.providerName,
      payerName: providerData.payerName,
      email: toEmail,
      success: emailResult.success,
      error: emailResult.error,
    };
  }

  /**
   * Get enrollment data for preview (includes all provider details)
   */
  async getEnrollmentEmailData(enrollmentId: string): Promise<FollowUpEmailData | null> {
    const enrollment = await prisma.enrollment.findUnique({
      where: { id: enrollmentId },
      include: {
        provider: {
          include: {
            practiceLocations: true,
          },
        },
        payer: true,
      },
    });

    if (!enrollment) return null;

    return this.extractProviderData(enrollment as EnrollmentWithRelations);
  }

  /**
   * Send a test follow-up email for a specific enrollment (legacy method)
   */
  async sendTestFollowUp(enrollmentId: string, testEmail?: string): Promise<FollowUpResult> {
    return this.sendCustomFollowUp(enrollmentId, testEmail || '');
  }

  /**
   * Configure follow-up settings for an enrollment
   */
  async configureFollowUp(
    enrollmentId: string,
    settings: {
      enabled: boolean;
      email?: string;
      frequencyDays?: number;
    }
  ): Promise<Enrollment | null> {
    const nextFollowUpDate = settings.enabled
      ? new Date(Date.now() + (settings.frequencyDays || 14) * 24 * 60 * 60 * 1000)
      : null;

    return prisma.enrollment.update({
      where: { id: enrollmentId },
      data: {
        followUpEnabled: settings.enabled,
        followUpEmail: settings.email,
        followUpFrequencyDays: settings.frequencyDays || 14,
        nextFollowUpDate,
      },
    });
  }
}

export const followUpService = new FollowUpService();
export default followUpService;
