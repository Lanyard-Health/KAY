import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prismaMock } from '../../tests/helpers/mock-prisma.js';

// Mock the prisma import so the service uses our mock
vi.mock('../utils/prisma.js', async () => {
  const { prismaMock } = await import('../../tests/helpers/mock-prisma.js');
  return { prisma: prismaMock };
});

// Set env vars before importing service
vi.stubEnv('RETELL_API_KEY', 'test-retell-key');
vi.stubEnv('RETELL_WEBHOOK_SECRET', 'test-webhook-secret');

import {
  initiateCall,
  processWebhook,
  verifyWebhookSignature,
  isRetellEnabled,
  getCallLogs,
} from './retell.service.js';

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('retell.service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('isRetellEnabled', () => {
    it('returns true when RETELL_API_KEY is set', () => {
      expect(isRetellEnabled()).toBe(true);
    });
  });

  describe('initiateCall', () => {
    it('calls Retell API and creates a RetellCallLog entry', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ call_id: 'retell-call-123' }),
      });

      prismaMock.retellCallLog.create.mockResolvedValueOnce({
        id: 'log-1',
        followUpRunId: 'run-1',
        retellCallId: 'retell-call-123',
        payerContactId: 'contact-1',
        phoneNumber: '+15551234567',
        status: 'initiated',
        outcome: null,
        transcript: null,
        durationSeconds: null,
        calledAt: new Date(),
        createdAt: new Date(),
      });

      const result = await initiateCall(prismaMock, {
        followUpRunId: 'run-1',
        agentId: 'agent-abc',
        phoneNumber: '+15551234567',
        payerContactId: 'contact-1',
      });

      expect(result.success).toBe(true);
      expect(result.callId).toBe('retell-call-123');
      expect(mockFetch).toHaveBeenCalledOnce();
      expect(prismaMock.retellCallLog.create).toHaveBeenCalledOnce();
    });

    it('returns error when Retell API fails', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () => 'Bad request',
      });

      const result = await initiateCall(prismaMock, {
        followUpRunId: 'run-1',
        agentId: 'agent-abc',
        phoneNumber: '+15551234567',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('400');
      expect(prismaMock.retellCallLog.create).not.toHaveBeenCalled();
    });

    it('handles network errors gracefully', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const result = await initiateCall(prismaMock, {
        followUpRunId: 'run-1',
        agentId: 'agent-abc',
        phoneNumber: '+15551234567',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Network error');
    });
  });

  describe('processWebhook', () => {
    it('updates RetellCallLog on call_ended event', async () => {
      prismaMock.retellCallLog.findFirst.mockResolvedValueOnce({
        id: 'log-1',
        followUpRunId: 'run-1',
        retellCallId: 'retell-call-123',
        payerContactId: null,
        phoneNumber: '+15551234567',
        status: 'initiated',
        outcome: null,
        transcript: null,
        durationSeconds: null,
        calledAt: new Date(),
        createdAt: new Date(),
      });

      prismaMock.retellCallLog.update.mockResolvedValueOnce({} as any);

      const result = await processWebhook(prismaMock, {
        event: 'call_ended',
        call: {
          call_id: 'retell-call-123',
          call_status: 'ended',
          start_timestamp: 1000000,
          end_timestamp: 1000180000, // 180 seconds
          transcript: 'Hello, this is a follow-up call...',
          disconnection_reason: 'agent_hangup',
          call_analysis: {
            call_summary: 'Called payer, confirmed enrollment is under review.',
          },
        },
      });

      expect(result.processed).toBe(true);
      expect(prismaMock.retellCallLog.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'log-1' },
          data: expect.objectContaining({
            status: 'completed',
            transcript: 'Hello, this is a follow-up call...',
          }),
        })
      );
    });

    it('maps voicemail_reached to voicemail status', async () => {
      prismaMock.retellCallLog.findFirst.mockResolvedValueOnce({
        id: 'log-2',
        followUpRunId: 'run-1',
        retellCallId: 'retell-call-456',
        payerContactId: null,
        phoneNumber: '+15551234567',
        status: 'initiated',
        outcome: null,
        transcript: null,
        durationSeconds: null,
        calledAt: new Date(),
        createdAt: new Date(),
      });

      prismaMock.retellCallLog.update.mockResolvedValueOnce({} as any);

      const result = await processWebhook(prismaMock, {
        event: 'call_ended',
        call: {
          call_id: 'retell-call-456',
          call_status: 'ended',
          disconnection_reason: 'voicemail_reached',
        },
      });

      expect(result.processed).toBe(true);
      expect(prismaMock.retellCallLog.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'voicemail',
          }),
        })
      );
    });

    it('ignores unhandled webhook events', async () => {
      const result = await processWebhook(prismaMock, {
        event: 'call_started',
        call: { call_id: 'retell-call-789', call_status: 'ongoing' },
      });

      expect(result.processed).toBe(false);
      expect(result.error).toContain('Unhandled event');
    });

    it('returns error when call log not found', async () => {
      prismaMock.retellCallLog.findFirst.mockResolvedValueOnce(null);

      const result = await processWebhook(prismaMock, {
        event: 'call_ended',
        call: { call_id: 'nonexistent', call_status: 'ended' },
      });

      expect(result.processed).toBe(false);
      expect(result.error).toBe('Call log not found');
    });
  });

  describe('verifyWebhookSignature', () => {
    it('returns true for valid signature', () => {
      const crypto = require('crypto');
      const payload = '{"event":"call_ended"}';
      const expectedSig = crypto
        .createHmac('sha256', 'test-webhook-secret')
        .update(payload)
        .digest('hex');

      expect(verifyWebhookSignature(payload, expectedSig)).toBe(true);
    });

    it('returns false for invalid signature', () => {
      // Must be same length as a hex SHA-256 (64 chars) for timingSafeEqual
      const fakeSig = 'a'.repeat(64);
      expect(verifyWebhookSignature('payload', fakeSig)).toBe(false);
    });
  });

  describe('getCallLogs', () => {
    it('queries call logs by followUpRunId', async () => {
      prismaMock.retellCallLog.findMany.mockResolvedValueOnce([]);

      await getCallLogs(prismaMock, 'run-1');

      expect(prismaMock.retellCallLog.findMany).toHaveBeenCalledWith({
        where: { followUpRunId: 'run-1' },
        orderBy: { calledAt: 'desc' },
      });
    });
  });
});
