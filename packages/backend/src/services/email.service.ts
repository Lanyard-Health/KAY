import { google } from 'googleapis';
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
}

class EmailService {
  private oauth2Client: InstanceType<typeof google.auth.OAuth2> | null = null;
  private senderEmail: string = '';
  private configured = false;

  constructor() {
    this.initialize();
  }

  private initialize(): void {
    const clientId = process.env['GMAIL_CLIENT_ID'];
    const clientSecret = process.env['GMAIL_CLIENT_SECRET'];
    const refreshToken = process.env['GMAIL_REFRESH_TOKEN'];
    const senderEmail = process.env['GMAIL_SENDER_EMAIL'];

    if (!clientId || !clientSecret || !refreshToken || !senderEmail) {
      console.warn('Email service not configured. Set GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN, GMAIL_SENDER_EMAIL in env');
      return;
    }

    this.oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
    this.oauth2Client.setCredentials({ refresh_token: refreshToken });
    this.senderEmail = senderEmail;
    this.configured = true;
  }

  isConfigured(): boolean {
    return this.configured;
  }

  getConfig(): { host: string; port: number; user: string } | null {
    if (!this.configured) return null;
    return {
      host: 'gmail-api',
      port: 443,
      user: this.senderEmail,
    };
  }

  async verifyConnection(): Promise<{ success: boolean; error?: string }> {
    if (!this.oauth2Client) {
      return { success: false, error: 'Email service not configured' };
    }

    try {
      await this.oauth2Client.getAccessToken();
      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, error: message };
    }
  }

  private buildMimeMessage(params: SendEmailParams): string {
    const boundary = `boundary_${Date.now().toString(36)}`;
    const to = params.to;
    const subject = params.subject;
    const text = params.text || params.html.replace(/<[^>]*>/g, '');

    const hasAttachments = params.attachments && params.attachments.length > 0;

    const lines: string[] = [];
    lines.push(`From: KAY Credentialing <${this.senderEmail}>`);
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
        lines.push(`Content-Type: ${att.contentType || 'application/octet-stream'}; name="${att.filename}"`);
        lines.push('Content-Transfer-Encoding: base64');
        lines.push(`Content-Disposition: attachment; filename="${att.filename}"`);
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
    if (!this.oauth2Client) {
      return { success: false, error: 'Email service not configured' };
    }

    try {
      const gmail = google.gmail({ version: 'v1', auth: this.oauth2Client });
      const rawMessage = this.buildMimeMessage(params);
      const encodedMessage = Buffer.from(rawMessage)
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');

      const result = await gmail.users.messages.send({
        userId: 'me',
        requestBody: {
          raw: encodedMessage,
        },
      });

      const messageId = result.data.id || undefined;

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

      return { success: true, messageId };
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
          <p>If you received this email, your Gmail API configuration is working correctly.</p>
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
