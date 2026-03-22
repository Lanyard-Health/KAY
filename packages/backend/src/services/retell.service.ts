/**
 * Retell AI Service
 *
 * Handles phone call follow-up steps via the Retell AI API.
 * Feature is disabled gracefully when RETELL_API_KEY is not set.
 *
 * Flow:
 *   1. Follow-up step (channel=phone_call) approved → initiateCall()
 *   2. Retell places the call → webhook callback → processWebhook()
 *   3. RetellCallLog created/updated with outcome
 */

import { PrismaClient } from '@prisma/client';
import { logger } from '../utils/logger.js';
import crypto from 'crypto';

// ─── Config (read lazily so tests can stub env vars) ─────

const RETELL_API_BASE = 'https://api.retell.ai';

function getRetellApiKey(): string {
  return process.env['RETELL_API_KEY'] || '';
}

function getWebhookSecret(): string {
  return process.env['RETELL_WEBHOOK_SECRET'] || '';
}

export function isRetellEnabled(): boolean {
  return getRetellApiKey().length > 0;
}

// ─── Types ───────────────────────────────────────────────

export interface InitiateCallParams {
  followUpRunId: string;
  agentId: string;
  phoneNumber: string;
  payerContactId?: string;
  metadata?: Record<string, string>;
}

export interface InitiateCallResult {
  success: boolean;
  callId?: string;
  error?: string;
}

export interface RetellWebhookPayload {
  event: string;
  call: {
    call_id: string;
    call_status: string; // ended, error
    start_timestamp?: number;
    end_timestamp?: number;
    transcript?: string;
    disconnection_reason?: string;
    call_analysis?: {
      call_summary?: string;
      user_sentiment?: string;
    };
    metadata?: Record<string, string>;
  };
}

// ─── Webhook Signature Verification ──────────────────────

/**
 * Verify Retell webhook signature.
 * Retell signs webhooks with HMAC-SHA256 using the webhook secret.
 */
export function verifyWebhookSignature(
  payload: string,
  signature: string
): boolean {
  const secret = getWebhookSecret();
  if (!secret) {
    logger.warn('RETELL_WEBHOOK_SECRET not set — skipping signature verification');
    return true; // Allow in dev
  }

  const expected = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex');

  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expected)
  );
}

// ─── API Calls ───────────────────────────────────────────

/**
 * Initiate a phone call via the Retell AI API.
 * Creates a RetellCallLog record and returns the Retell call ID.
 */
export async function initiateCall(
  prisma: PrismaClient,
  params: InitiateCallParams
): Promise<InitiateCallResult> {
  if (!isRetellEnabled()) {
    logger.warn('Retell AI not configured — RETELL_API_KEY missing');
    return { success: false, error: 'Retell AI not configured' };
  }

  const { followUpRunId, agentId, phoneNumber, payerContactId, metadata } = params;

  try {
    const response = await fetch(`${RETELL_API_BASE}/v2/create-phone-call`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${getRetellApiKey()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        agent_id: agentId,
        customer_number: phoneNumber,
        metadata: {
          follow_up_run_id: followUpRunId,
          payer_contact_id: payerContactId || '',
          ...metadata,
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error(`Retell API error (${response.status}): ${errorText}`);
      return { success: false, error: `Retell API returned ${response.status}` };
    }

    const data = await response.json() as { call_id: string };
    const callId = data.call_id;

    // Create initial RetellCallLog entry
    await prisma.retellCallLog.create({
      data: {
        followUpRunId,
        retellCallId: callId,
        payerContactId: payerContactId || null,
        phoneNumber,
        status: 'initiated',
        calledAt: new Date(),
      },
    });

    logger.info(`Retell call initiated: ${callId} for follow-up run ${followUpRunId}`);
    return { success: true, callId };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error(`Failed to initiate Retell call: ${message}`);
    return { success: false, error: message };
  }
}

// ─── Webhook Processing ─────────────────────────────────

/**
 * Process a Retell webhook callback.
 * Updates the RetellCallLog with call outcome, transcript, and duration.
 */
export async function processWebhook(
  prisma: PrismaClient,
  payload: RetellWebhookPayload
): Promise<{ processed: boolean; error?: string }> {
  const { event, call } = payload;

  if (event !== 'call_ended' && event !== 'call_analyzed') {
    logger.info(`Ignoring Retell webhook event: ${event}`);
    return { processed: false, error: `Unhandled event: ${event}` };
  }

  const callLog = await prisma.retellCallLog.findFirst({
    where: { retellCallId: call.call_id },
  });

  if (!callLog) {
    logger.warn(`No RetellCallLog found for call_id: ${call.call_id}`);
    return { processed: false, error: 'Call log not found' };
  }

  // Map Retell disconnection reasons to our status values
  const statusMap: Record<string, string> = {
    agent_hangup: 'completed',
    customer_hangup: 'completed',
    call_transfer: 'completed',
    voicemail_reached: 'voicemail',
    inactivity: 'no_answer',
    machine_detected: 'voicemail',
    max_duration_reached: 'completed',
    dial_busy: 'failed',
    dial_failed: 'failed',
    dial_no_answer: 'no_answer',
    error_inbound_webhook: 'failed',
    error_llm_websocket: 'failed',
    error_frontend_corrupted_payload: 'failed',
    error_twilio: 'failed',
  };

  const disconnectionReason = call.disconnection_reason || 'unknown';
  const status = statusMap[disconnectionReason] || 'completed';

  // Calculate duration
  let durationSeconds: number | null = null;
  if (call.start_timestamp && call.end_timestamp) {
    durationSeconds = Math.round((call.end_timestamp - call.start_timestamp) / 1000);
  }

  // Build outcome summary
  const outcome = call.call_analysis?.call_summary || disconnectionReason;

  await prisma.retellCallLog.update({
    where: { id: callLog.id },
    data: {
      status,
      outcome,
      transcript: call.transcript || null,
      durationSeconds,
    },
  });

  logger.info(`Retell call ${call.call_id} processed: status=${status}, duration=${durationSeconds}s`);
  return { processed: true };
}

// ─── Query Helpers ───────────────────────────────────────

/**
 * Get call logs for a specific FollowUpRun.
 */
export async function getCallLogs(
  prisma: PrismaClient,
  followUpRunId: string
) {
  return prisma.retellCallLog.findMany({
    where: { followUpRunId },
    orderBy: { calledAt: 'desc' },
  });
}
