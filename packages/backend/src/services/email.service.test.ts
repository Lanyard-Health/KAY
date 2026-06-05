import { describe, it, expect, vi, beforeEach } from 'vitest';

// Must set env vars before module evaluates
const mockSend = vi.hoisted(() => {
  process.env['RESEND_FROM_EMAIL'] = 'test@lanyard.com';
  process.env['RESEND_API_KEY'] = 're_test_123';
  return vi.fn();
});

vi.mock('resend', () => {
  return {
    Resend: function() {
      this.emails = { send: mockSend };
    },
  };
});

vi.mock('../utils/prisma.js', async () => {
  const { prismaMock } = await import('../../tests/helpers/mock-prisma.js');
  return { prisma: prismaMock, prismaBase: prismaMock };
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
    it('returns Resend config when configured', () => {
      const config = emailService.getConfig();
      expect(config).toEqual({
        host: 'resend',
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
    it('sends via Resend and logs notification on success', async () => {
      mockSend.mockResolvedValue({ data: { id: 'msg-123' }, error: null });

      const result = await emailService.sendEmail({
        to: 'user@example.com',
        subject: 'Test Subject',
        html: '<p>Hello</p>',
      });

      expect(result).toEqual(expect.objectContaining({ success: true, messageId: 'msg-123' }));
      expect(mockSend).toHaveBeenCalledOnce();
      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          from: 'Lanyard Health <test@lanyard.com>',
          to: 'user@example.com',
          subject: 'Test Subject',
          html: '<p>Hello</p>',
        }),
      );
      expect(prismaMock.notification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            recipientEmail: 'user@example.com',
            status: 'sent',
          }),
        }),
      );
    });

    it('logs failed notification on Resend error response', async () => {
      mockSend.mockResolvedValue({ data: null, error: { message: 'Rate limit exceeded' } });

      const result = await emailService.sendEmail({
        to: 'user@example.com',
        subject: 'Test',
        html: '<p>Test</p>',
      });

      expect(result).toEqual(expect.objectContaining({ success: false, error: 'Rate limit exceeded' }));
      expect(prismaMock.notification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'failed',
            errorMessage: 'Rate limit exceeded',
          }),
        }),
      );
    });

    it('logs failed notification on thrown error', async () => {
      mockSend.mockRejectedValue(new Error('Network failure'));

      const result = await emailService.sendEmail({
        to: 'user@example.com',
        subject: 'Test',
        html: '<p>Test</p>',
      });

      expect(result).toEqual(expect.objectContaining({ success: false, error: 'Network failure' }));
      expect(prismaMock.notification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'failed',
            errorMessage: 'Network failure',
          }),
        }),
      );
    });

    it('includes attachments in Resend payload', async () => {
      mockSend.mockResolvedValue({ data: { id: 'msg-789' }, error: null });

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

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          attachments: [
            expect.objectContaining({
              filename: 'report.pdf',
              content: Buffer.from('fake-pdf-content'),
            }),
          ],
        }),
      );
    });

    it('generates plain text from HTML when text not provided', async () => {
      mockSend.mockResolvedValue({ data: { id: 'msg-000' }, error: null });

      await emailService.sendEmail({
        to: 'user@example.com',
        subject: 'Test',
        html: '<p>Hello <b>World</b></p>',
      });

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          text: 'Hello World',
        }),
      );
    });
  });

  describe('sendTestEmail', () => {
    it('delegates to sendEmail with test template', async () => {
      mockSend.mockResolvedValue({ data: { id: 'test-msg' }, error: null });

      const result = await emailService.sendTestEmail('test@example.com');

      expect(result.success).toBe(true);
      expect(mockSend).toHaveBeenCalledOnce();
      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'test@example.com',
          html: expect.stringContaining('Test Email Successful'),
        }),
      );
    });
  });
});
