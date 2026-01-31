import nodemailer from 'nodemailer';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface EmailConfig {
  host: string;
  port: number;
  secure: boolean;
  auth: {
    user: string;
    pass: string;
  };
}

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
}

class EmailService {
  private transporter: nodemailer.Transporter | null = null;
  private config: EmailConfig | null = null;

  constructor() {
    this.initializeTransporter();
  }

  private initializeTransporter(): void {
    const host = process.env['SMTP_HOST'];
    const port = parseInt(process.env['SMTP_PORT'] || '587', 10);
    const user = process.env['SMTP_USER'];
    const pass = process.env['SMTP_PASS'];

    if (!host || !user || !pass) {
      console.warn('Email service not configured. Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS in .env');
      return;
    }

    this.config = {
      host,
      port,
      secure: port === 465,
      auth: { user, pass },
    };

    this.transporter = nodemailer.createTransport(this.config);
  }

  isConfigured(): boolean {
    return this.transporter !== null;
  }

  getConfig(): { host: string; port: number; user: string } | null {
    if (!this.config) return null;
    return {
      host: this.config.host,
      port: this.config.port,
      user: this.config.auth.user,
    };
  }

  async verifyConnection(): Promise<{ success: boolean; error?: string }> {
    if (!this.transporter) {
      return { success: false, error: 'Email service not configured' };
    }

    try {
      await this.transporter.verify();
      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, error: message };
    }
  }

  async sendEmail(params: SendEmailParams): Promise<{ success: boolean; messageId?: string; error?: string }> {
    if (!this.transporter) {
      return { success: false, error: 'Email service not configured' };
    }

    const from = process.env['SMTP_FROM'] || process.env['SMTP_USER'];

    try {
      const result = await this.transporter.sendMail({
        from,
        to: params.to,
        subject: params.subject,
        html: params.html,
        text: params.text || params.html.replace(/<[^>]*>/g, ''),
        attachments: params.attachments?.map((att) => ({
          filename: att.filename,
          content: att.content,
          contentType: att.contentType,
        })),
      });

      // Log notification
      await prisma.notification.create({
        data: {
          recipientEmail: params.to,
          type: 'enrollment_follow_up',
          subject: params.subject,
          body: params.html,
          status: 'sent',
          sentAt: new Date(),
        },
      });

      return { success: true, messageId: result.messageId };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';

      // Log failed notification
      await prisma.notification.create({
        data: {
          recipientEmail: params.to,
          type: 'enrollment_follow_up',
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
      subject: 'Test Email - KAY Credentialing System',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #2563eb;">Test Email Successful!</h2>
          <p>This is a test email from the KAY Healthcare Credentialing System.</p>
          <p>If you received this email, your SMTP configuration is working correctly.</p>
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
