/**
 * Webhook authentication helpers for the generic enrollment-status webhook.
 *
 * Uses HMAC-SHA256 over the raw request body, plus a timestamp guard to
 * prevent replays. Modeled on the Retell webhook pattern in
 * services/retell.service.ts but with a stricter timestamp tolerance and a
 * dedicated env var so external integrators can rotate this secret
 * independently of any third-party vendor secrets.
 */

import crypto from 'node:crypto';
import { logger } from '../utils/logger.js';

const TIMESTAMP_TOLERANCE_MS = 5 * 60 * 1000; // 5 minutes — replays older than this are rejected

export function getEnrollmentWebhookSecret(): string | null {
  const secret = process.env['ENROLLMENT_WEBHOOK_SECRET'];
  if (!secret || secret.length === 0) return null;
  return secret;
}

/**
 * Verify HMAC-SHA256 signature over the raw request body.
 * Returns false (and logs at warn level) when the secret is unset OR the
 * signature doesn't match. Constant-time comparison via timingSafeEqual.
 */
export function verifyEnrollmentWebhookSignature(rawBody: string, signature: string): boolean {
  const secret = getEnrollmentWebhookSecret();
  if (!secret) {
    logger.warn('ENROLLMENT_WEBHOOK_SECRET not set — rejecting webhook');
    return false;
  }

  const expected = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex');

  // Buffers must be the same length for timingSafeEqual; mismatched lengths
  // are an immediate failure since they can't possibly be equal.
  if (signature.length !== expected.length) return false;

  try {
    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expected),
    );
  } catch {
    return false;
  }
}

/**
 * Returns true if the supplied ISO timestamp is within
 * `TIMESTAMP_TOLERANCE_MS` of the current server clock. Rejects timestamps
 * that fail to parse or are too far in the past or future.
 */
export function timestampWithinTolerance(timestampHeader: string): boolean {
  if (!timestampHeader) return false;
  const ts = Date.parse(timestampHeader);
  if (Number.isNaN(ts)) return false;
  const drift = Math.abs(Date.now() - ts);
  return drift <= TIMESTAMP_TOLERANCE_MS;
}
