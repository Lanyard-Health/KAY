import { Resend } from 'resend';
import { prisma } from '../utils/prisma.js';
import { logger } from '../utils/logger.js';

interface Attachment {
  filename: string;
  content: Buffer | string;
  contentType?: string;
}

interface SendEmailParams {
  to: string;
  subject: string;
  html: string;
  text?: string;
  attachments?: Attachment[];
  notificationType?: string;
}

class EmailService {
  private resendClient: Resend | null = null;
  private fromEmail: string = '';
  private configured = false;

  constructor() {
    this.initialize();
  }

  private initialize(): void {
    const fromEmail = process.env['RESEND_FROM_EMAIL'] || process.env['SES_FROM_EMAIL'];
    const apiKey = process.env['RESEND_API_KEY'];

    if (process.env['SES_FROM_EMAIL'] && !process.env['RESEND_FROM_EMAIL']) {
      logger.warn('SES_FROM_EMAIL is deprecated — rename to RESEND_FROM_EMAIL in your env');
    }

    if (!fromEmail) {
      logger.warn('Email service not configured. Set RESEND_FROM_EMAIL env var to enable email sending.');
      return;
    }

    if (!apiKey) {
      logger.warn('Email service not configured. Set RESEND_API_KEY env var to enable email sending.');
      return;
    }

    this.resendClient = new Resend(apiKey);
    this.fromEmail = fromEmail;
    this.configured = true;
    logger.info(`Email service configured with Resend (from: ${fromEmail})`);
  }

  isConfigured(): boolean {
    return this.configured;
  }

  getConfig(): { host: string; port: number; user: string } | null {
    if (!this.configured) return null;
    return {
      host: 'resend',
      port: 443,
      user: this.fromEmail,
    };
  }

  async verifyConnection(): Promise<{ success: boolean; error?: string }> {
    if (!this.resendClient) {
      return { success: false, error: 'Email service not configured' };
    }

    return { success: true };
  }

  async sendEmail(params: SendEmailParams): Promise<{ success: boolean; messageId?: string; error?: string }> {
    if (!this.resendClient) {
      logger.warn(`Email skipped (not configured): to=${params.to}, subject="${params.subject}"`);
      return { success: false, error: 'Email service not configured' };
    }

    try {
      const resendPayload: {
        from: string;
        to: string;
        subject: string;
        html: string;
        text?: string;
        attachments?: { filename: string; content: Buffer }[];
      } = {
        from: `Lanyard Health <${this.fromEmail}>`,
        to: params.to,
        subject: params.subject,
        html: params.html,
        text: params.text || params.html.replace(/<[^>]*>/g, ''),
      };

      if (params.attachments && params.attachments.length > 0) {
        resendPayload.attachments = params.attachments.map((att) => ({
          filename: att.filename,
          content: Buffer.isBuffer(att.content)
            ? att.content
            : Buffer.from(att.content as string),
        }));
      }

      const { data, error } = await this.resendClient.emails.send(resendPayload);

      if (error) {
        throw new Error(error.message);
      }

      const messageId = data?.id;

      // Log notification
      await prisma.notification.create({
        data: {
          recipientEmail: params.to,
          type: (params.notificationType || 'enrollment_follow_up') as any,
          subject: params.subject,
          body: params.html,
          status: 'sent',
          sentAt: new Date(),
        },
      });

      return { success: true, messageId };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`Email send failed: to=${params.to}, error=${message}`);

      // Log failed notification
      await prisma.notification.create({
        data: {
          recipientEmail: params.to,
          type: (params.notificationType || 'enrollment_follow_up') as any,
          subject: params.subject,
          body: params.html,
          status: 'failed',
          errorMessage: message,
        },
      });

      return { success: false, error: message };
    }
  }

  async sendTestEmail(to: string): Promise<{ success: boolean; messageId?: string; error?: string }> {
    return this.sendEmail({
      to,
      subject: 'Test Email - Lanyard Health',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #0A3D2E;">Test Email Successful!</h2>
          <p>This is a test email from Lanyard Health.</p>
          <p>If you received this email, your email configuration is working correctly.</p>
          <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;" />
          <p style="color: #6b7280; font-size: 12px;">
            Sent at: ${new Date().toLocaleString()}
          </p>
        </div>
      `,
    });
  }
}

export const emailService = new EmailService();
export default emailService;
