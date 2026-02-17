import { SESClient, SendRawEmailCommand } from '@aws-sdk/client-ses';
import { prisma } from '../utils/prisma.js';

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
  private sesClient: SESClient | null = null;
  private fromEmail: string = '';
  private configured = false;

  constructor() {
    this.initialize();
  }

  private initialize(): void {
    const fromEmail = process.env['SES_FROM_EMAIL'];
    const accessKeyId = process.env['AWS_ACCESS_KEY_ID'];
    const secretAccessKey = process.env['AWS_SECRET_ACCESS_KEY'];

    if (!fromEmail) {
      console.warn('Email service not configured. Set SES_FROM_EMAIL env var to enable email sending.');
      return;
    }

    if (!accessKeyId || !secretAccessKey) {
      console.warn('Email service not configured. Set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY env vars.');
      return;
    }

    const region = process.env['AWS_SES_REGION'] || 'us-east-1';

    this.sesClient = new SESClient({
      region,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
    });

    this.fromEmail = fromEmail;
    this.configured = true;
    console.log(`Email service configured with SES (region: ${region}, from: ${fromEmail})`);
  }

  isConfigured(): boolean {
    return this.configured;
  }

  getConfig(): { host: string; port: number; user: string } | null {
    if (!this.configured) return null;
    return {
      host: 'ses',
      port: 443,
      user: this.fromEmail,
    };
  }

  async verifyConnection(): Promise<{ success: boolean; error?: string }> {
    if (!this.sesClient) {
      return { success: false, error: 'Email service not configured' };
    }

    return { success: true };
  }

  /** Strip CRLF sequences to prevent email header injection */
  private sanitizeHeader(value: string): string {
    return value.replace(/[\r\n]/g, '');
  }

  private buildMimeMessage(params: SendEmailParams): string {
    const boundary = `boundary_${Date.now().toString(36)}`;
    const to = this.sanitizeHeader(params.to);
    const subject = this.sanitizeHeader(params.subject);
    const text = params.text || params.html.replace(/<[^>]*>/g, '');

    const hasAttachments = params.attachments && params.attachments.length > 0;

    const lines: string[] = [];
    lines.push(`From: Lanyard Health <${this.fromEmail}>`);
    lines.push(`To: ${to}`);
    lines.push(`Subject: ${subject}`);
    lines.push('MIME-Version: 1.0');

    if (hasAttachments) {
      lines.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);
      lines.push('');
      lines.push(`--${boundary}`);
      lines.push('Content-Type: multipart/alternative; boundary="alt_boundary"');
      lines.push('');
      lines.push('--alt_boundary');
      lines.push('Content-Type: text/plain; charset=UTF-8');
      lines.push('');
      lines.push(text);
      lines.push('');
      lines.push('--alt_boundary');
      lines.push('Content-Type: text/html; charset=UTF-8');
      lines.push('');
      lines.push(params.html);
      lines.push('');
      lines.push('--alt_boundary--');

      for (const att of params.attachments!) {
        const contentBytes = Buffer.isBuffer(att.content)
          ? att.content
          : Buffer.from(att.content as string);
        lines.push('');
        lines.push(`--${boundary}`);
        const safeFilename = this.sanitizeHeader(att.filename).replace(/"/g, '\\"');
        lines.push(`Content-Type: ${att.contentType || 'application/octet-stream'}; name="${safeFilename}"`);
        lines.push('Content-Transfer-Encoding: base64');
        lines.push(`Content-Disposition: attachment; filename="${safeFilename}"`);
        lines.push('');
        lines.push(contentBytes.toString('base64'));
      }
      lines.push('');
      lines.push(`--${boundary}--`);
    } else {
      lines.push('Content-Type: multipart/alternative; boundary="alt_boundary"');
      lines.push('');
      lines.push('--alt_boundary');
      lines.push('Content-Type: text/plain; charset=UTF-8');
      lines.push('');
      lines.push(text);
      lines.push('');
      lines.push('--alt_boundary');
      lines.push('Content-Type: text/html; charset=UTF-8');
      lines.push('');
      lines.push(params.html);
      lines.push('');
      lines.push('--alt_boundary--');
    }

    return lines.join('\r\n');
  }

  async sendEmail(params: SendEmailParams): Promise<{ success: boolean; messageId?: string; error?: string }> {
    if (!this.sesClient) {
      console.warn(`Email skipped (not configured): to=${params.to}, subject="${params.subject}"`);
      return { success: false, error: 'Email service not configured' };
    }

    try {
      const rawMessage = this.buildMimeMessage(params);

      const command = new SendRawEmailCommand({
        RawMessage: {
          Data: Buffer.from(rawMessage),
        },
        Source: this.fromEmail,
        Destinations: [params.to],
      });

      const result = await this.sesClient.send(command);
      const messageId = result.MessageId || undefined;

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
      console.error(`Email send failed: to=${params.to}, error=${message}`);

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
          <p>If you received this email, your AWS SES configuration is working correctly.</p>
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
