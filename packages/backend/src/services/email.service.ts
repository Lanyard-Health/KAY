import { Resend } from 'resend';
import nodemailer, { type Transporter } from 'nodemailer';
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
  replyTo?: string;
}

type Transport = 'resend' | 'smtp' | 'none';

/**
 * Email service with two transports:
 *  • Resend (preferred when RESEND_API_KEY is set)
 *  • SMTP fallback (any env with SMTP_HOST+SMTP_USER+SMTP_PASS)
 * If neither is configured the service no-ops + logs — same as the old
 * Resend-only behavior — so dev environments without creds still boot.
 */
class EmailService {
  private resendClient: Resend | null = null;
  private smtpTransport: Transporter | null = null;
  private transport: Transport = 'none';
  private fromEmail: string = '';
  private configured = false;

  constructor() {
    this.initialize();
  }

  private initialize(): void {
    const resendFrom = process.env['RESEND_FROM_EMAIL'] || process.env['SES_FROM_EMAIL'];
    const resendKey = process.env['RESEND_API_KEY'];
    const smtpHost = process.env['SMTP_HOST'];
    const smtpUser = process.env['SMTP_USER'];
    const smtpPass = process.env['SMTP_PASS'];
    const smtpFrom = process.env['SMTP_FROM'] || smtpUser;

    if (process.env['SES_FROM_EMAIL'] && !process.env['RESEND_FROM_EMAIL']) {
      logger.warn('SES_FROM_EMAIL is deprecated — rename to RESEND_FROM_EMAIL in your env');
    }

    // Prefer Resend when both API key + from address are set
    if (resendKey && resendFrom) {
      this.resendClient = new Resend(resendKey);
      this.fromEmail = resendFrom;
      this.transport = 'resend';
      this.configured = true;
      logger.info(`Email service configured with Resend (from: ${resendFrom})`);
      return;
    }

    // Fall back to SMTP
    if (smtpHost && smtpUser && smtpPass && smtpFrom) {
      this.smtpTransport = nodemailer.createTransport({
        host: smtpHost,
        port: Number(process.env['SMTP_PORT'] || 587),
        secure: Number(process.env['SMTP_PORT']) === 465,
        auth: { user: smtpUser, pass: smtpPass },
      });
      this.fromEmail = smtpFrom;
      this.transport = 'smtp';
      this.configured = true;
      logger.info(`Email service configured with SMTP (host: ${smtpHost}, from: ${smtpFrom})`);
      return;
    }

    logger.warn('Email service not configured. Set RESEND_API_KEY+RESEND_FROM_EMAIL or SMTP_* env vars to enable email sending.');
  }

  isConfigured(): boolean {
    return this.configured;
  }

  getTransport(): Transport {
    return this.transport;
  }

  getConfig(): { host: string; port: number; user: string } | null {
    if (!this.configured) return null;
    if (this.transport === 'resend') {
      return { host: 'resend', port: 443, user: this.fromEmail };
    }
    return {
      host: process.env['SMTP_HOST'] || 'smtp',
      port: Number(process.env['SMTP_PORT'] || 587),
      user: this.fromEmail,
    };
  }

  async verifyConnection(): Promise<{ success: boolean; error?: string }> {
    if (!this.configured) return { success: false, error: 'Email service not configured' };
    if (this.transport === 'smtp' && this.smtpTransport) {
      try {
        await this.smtpTransport.verify();
        return { success: true };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : 'SMTP verify failed' };
      }
    }
    return { success: true };
  }

  async sendEmail(params: SendEmailParams): Promise<{ success: boolean; messageId?: string; error?: string; transport?: Transport }> {
    if (!this.configured) {
      logger.warn(`Email skipped (not configured): to=${params.to}, subject="${params.subject}"`);
      return { success: false, error: 'Email service not configured', transport: 'none' };
    }

    const plainText = params.text || params.html.replace(/<[^>]*>/g, '');

    try {
      let messageId: string | undefined;

      if (this.transport === 'resend' && this.resendClient) {
        const resendPayload: {
          from: string;
          to: string;
          subject: string;
          html: string;
          text: string;
          reply_to?: string;
          attachments?: { filename: string; content: Buffer }[];
        } = {
          from: `Lanyard Health <${this.fromEmail}>`,
          to: params.to,
          subject: params.subject,
          html: params.html,
          text: plainText,
        };
        if (params.replyTo) {
          resendPayload.reply_to = params.replyTo;
        }
        if (params.attachments?.length) {
          resendPayload.attachments = params.attachments.map((att) => ({
            filename: att.filename,
            content: Buffer.isBuffer(att.content) ? att.content : Buffer.from(att.content as string),
          }));
        }
        const { data, error } = await this.resendClient.emails.send(resendPayload);
        if (error) throw new Error(error.message);
        messageId = data?.id;
      } else if (this.transport === 'smtp' && this.smtpTransport) {
        const info = await this.smtpTransport.sendMail({
          from: `Lanyard Health <${this.fromEmail}>`,
          to: params.to,
          subject: params.subject,
          html: params.html,
          text: plainText,
          ...(params.replyTo ? { replyTo: params.replyTo } : {}),
          attachments: params.attachments?.map((att) => ({
            filename: att.filename,
            content: att.content,
            contentType: att.contentType,
          })),
        });
        messageId = info.messageId;
      } else {
        throw new Error(`No transport available (state: ${this.transport})`);
      }

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

      return { success: true, messageId, transport: this.transport };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`Email send failed (${this.transport}): to=${params.to}, error=${message}`);

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

      return { success: false, error: message, transport: this.transport };
    }
  }

  async sendTestEmail(to: string): Promise<{ success: boolean; messageId?: string; error?: string; transport?: Transport }> {
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
