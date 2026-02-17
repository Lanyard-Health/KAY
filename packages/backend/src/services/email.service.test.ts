import { describe, it, expect, vi, beforeEach } from 'vitest';

// Must set env vars before module evaluates
const mockSend = vi.hoisted(() => {
  process.env['SES_FROM_EMAIL'] = 'test@lanyard.com';
  process.env['AWS_ACCESS_KEY_ID'] = 'test-key';
  process.env['AWS_SECRET_ACCESS_KEY'] = 'test-secret';
  process.env['AWS_SES_REGION'] = 'us-east-1';
  return vi.fn();
});

vi.mock('@aws-sdk/client-ses', () => {
  return {
    SESClient: function() { this.send = mockSend; },
    SendRawEmailCommand: function(params: any) { this.params = params; },
  };
});

vi.mock('../utils/prisma.js', async () => {
  const { prismaMock } = await import('../../tests/helpers/mock-prisma.js');
  return { prisma: prismaMock };
});

vi.mock('../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { emailService } from './email.service.js';
import { prismaMock } from '../../tests/helpers/mock-prisma.js';

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.notification.create.mockResolvedValue({} as any);
});

describe('EmailService', () => {
  describe('isConfigured', () => {
    it('returns true when env vars are set', () => {
      expect(emailService.isConfigured()).toBe(true);
    });
  });

  describe('getConfig', () => {
    it('returns SES config when configured', () => {
      const config = emailService.getConfig();
      expect(config).toEqual({
        host: 'ses',
        port: 443,
        user: 'test@lanyard.com',
      });
    });
  });

  describe('verifyConnection', () => {
    it('returns success when configured', async () => {
      const result = await emailService.verifyConnection();
      expect(result).toEqual({ success: true });
    });
  });

  describe('sendEmail', () => {
    it('sends raw MIME via SES and logs notification on success', async () => {
      mockSend.mockResolvedValue({ MessageId: 'msg-123' });

      const result = await emailService.sendEmail({
        to: 'user@example.com',
        subject: 'Test Subject',
        html: '<p>Hello</p>',
      });

      expect(result).toEqual({ success: true, messageId: 'msg-123' });
      expect(mockSend).toHaveBeenCalledOnce();
      expect(prismaMock.notification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            recipientEmail: 'user@example.com',
            status: 'sent',
          }),
        }),
      );
    });

    it('logs failed notification on SES error', async () => {
      mockSend.mockRejectedValue(new Error('SES rate limit'));

      const result = await emailService.sendEmail({
        to: 'user@example.com',
        subject: 'Test',
        html: '<p>Test</p>',
      });

      expect(result).toEqual({ success: false, error: 'SES rate limit' });
      expect(prismaMock.notification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'failed',
            errorMessage: 'SES rate limit',
          }),
        }),
      );
    });

    it('strips CRLF from to and subject headers (injection prevention)', async () => {
      mockSend.mockResolvedValue({ MessageId: 'msg-456' });

      await emailService.sendEmail({
        to: "evil@test.com\r\nBcc: attacker@evil.com",
        subject: "Normal\r\nBcc: attacker@evil.com",
        html: '<p>Hello</p>',
      });

      const sendCall = mockSend.mock.calls[0]![0];
      const rawData = Buffer.from(sendCall.params.RawMessage.Data).toString();
      expect(rawData).not.toContain('\r\nBcc:');
    });

    it('includes base64 attachments in MIME message', async () => {
      mockSend.mockResolvedValue({ MessageId: 'msg-789' });

      await emailService.sendEmail({
        to: 'user@example.com',
        subject: 'With Attachment',
        html: '<p>See attached</p>',
        attachments: [{
          filename: 'report.pdf',
          content: Buffer.from('fake-pdf-content'),
          contentType: 'application/pdf',
        }],
      });

      const sendCall = mockSend.mock.calls[0]![0];
      const rawData = Buffer.from(sendCall.params.RawMessage.Data).toString();
      expect(rawData).toContain('Content-Disposition: attachment; filename="report.pdf"');
      expect(rawData).toContain('Content-Transfer-Encoding: base64');
      expect(rawData).toContain(Buffer.from('fake-pdf-content').toString('base64'));
    });

    it('generates plain text from HTML when text not provided', async () => {
      mockSend.mockResolvedValue({ MessageId: 'msg-000' });

      await emailService.sendEmail({
        to: 'user@example.com',
        subject: 'Test',
        html: '<p>Hello <b>World</b></p>',
      });

      const sendCall = mockSend.mock.calls[0]![0];
      const rawData = Buffer.from(sendCall.params.RawMessage.Data).toString();
      expect(rawData).toContain('Hello World');
    });
  });

  describe('sendTestEmail', () => {
    it('delegates to sendEmail with test template', async () => {
      mockSend.mockResolvedValue({ MessageId: 'test-msg' });

      const result = await emailService.sendTestEmail('test@example.com');

      expect(result.success).toBe(true);
      expect(mockSend).toHaveBeenCalledOnce();
      const sendCall = mockSend.mock.calls[0]![0];
      const rawData = Buffer.from(sendCall.params.RawMessage.Data).toString();
      expect(rawData).toContain('Test Email Successful');
      expect(rawData).toContain('test@example.com');
    });
  });
});
