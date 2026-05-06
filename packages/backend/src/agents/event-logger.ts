import { createHash, randomUUID } from 'node:crypto';

import { prisma } from '../utils/prisma.js';
import { logger } from '../utils/logger.js';
import { canonicalize, signAgentEvent } from '../utils/agent-signing.js';

import type { Prisma } from '@prisma/client';

export interface LogAgentEventInput {
  workflowId: string;
  taskId?: string;
  agent: string;
  action: string;
  data: Prisma.InputJsonValue;
  level?: 'debug' | 'info' | 'warn' | 'error';
}

// FROZEN canonical payload format. Changing the shape, field set, or
// timestamp serialization here forks the chain and breaks verification of
// every previously-signed event. External verifiers reproduce this exact
// object before hashing/verifying.
//
// Fields:
//   id           — uuid generated client-side so the row identity is part
//                  of the signed canonical (prevents an attacker swapping
//                  the same content between two rows).
//   workflowId   — chain key.
//   taskId       — null if absent.
//   agent, action, data, level — application content as logged.
//   timestamp    — ISO 8601 with millisecond precision in UTC ("...Z").
//   prevHash     — SHA-256 hex of the previous event in the workflow,
//                  or null for the first event in a workflow chain
//                  (first event of a pre-existing workflow also gets null
//                  per Phase 0.A boundary handling decision).
type CanonicalEvent = {
  id: string;
  workflowId: string;
  taskId: string | null;
  agent: string;
  action: string;
  data: Prisma.InputJsonValue;
  level: string;
  timestamp: string;
  prevHash: string | null;
};

const MAX_SERIALIZABLE_RETRIES = 5;

function getSigningMode(): 'shadow' | 'enforce' {
  return process.env['AGENT_SIGNING_MODE'] === 'enforce' ? 'enforce' : 'shadow';
}

// Postgres serialization failures bubble up through Prisma as P2034.
// Older builds surface the raw 40001 SQLSTATE in the message — match either.
function isSerializationFailure(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const code = (err as { code?: string }).code;
  if (code === 'P2034') return true;
  const msg = (err as { message?: string }).message ?? '';
  return msg.includes('40001') || msg.toLowerCase().includes('could not serialize');
}

/**
 * Logs an agent event with a SHA-256 hash chain per workflow and an Ed25519
 * signature over the canonical payload. Preserves the existing fail-soft
 * contract — never throws; returns null on any persistent error.
 *
 * Concurrency: each call runs inside a Serializable transaction so two
 * parallel writes to the same workflow can't fork the chain. On 40001
 * (Postgres serialization failure), the transaction retries up to
 * MAX_SERIALIZABLE_RETRIES times with small jitter before giving up.
 *
 * Signing failure handling honors AGENT_SIGNING_MODE:
 *   shadow (default): chain columns still written; signature columns NULL;
 *                     the underlying signing failure already logged via
 *                     signAgentEvent at warn/error level.
 *   enforce:          signatureKeyId='unsigned', surfaced at error level
 *                     so Sentry pages on-call (acceptance criterion: every
 *                     post-migration event has either a valid signature OR
 *                     an 'unsigned' marker).
 */
export async function logAgentEvent(input: LogAgentEventInput) {
  const id = randomUUID();
  const timestamp = new Date();
  const taskId = input.taskId ?? null;
  const level = input.level ?? 'info';
  const mode = getSigningMode();

  for (let attempt = 0; attempt < MAX_SERIALIZABLE_RETRIES; attempt++) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          const tail = await tx.agentEvent.findFirst({
            where: { workflowId: input.workflowId },
            orderBy: { timestamp: 'desc' },
            select: { eventHash: true },
          });
          const prevHash = tail?.eventHash ?? null;

          let eventHash: string | null = null;
          let signature: string | null = null;
          let signatureKeyId: string | null = null;

          try {
            const canonicalEvent: CanonicalEvent = {
              id,
              workflowId: input.workflowId,
              taskId,
              agent: input.agent,
              action: input.action,
              data: input.data,
              level,
              timestamp: timestamp.toISOString(),
              prevHash,
            };
            const canonical = canonicalize(canonicalEvent);
            eventHash = createHash('sha256').update(canonical).digest('hex');

            const signed = signAgentEvent(canonical);
            if (signed.signature !== null) {
              signature = signed.signature;
              signatureKeyId = signed.keyId;
            } else if (mode === 'enforce') {
              signatureKeyId = 'unsigned';
              logger.error(
                'SECURITY P1: agent event written as unsigned in enforce mode',
                {
                  workflowId: input.workflowId,
                  agent: input.agent,
                  action: input.action,
                  eventId: id,
                }
              );
            }
            // shadow mode + signing failure → both columns left NULL.
            // signAgentEvent already logged the underlying cause.
          } catch (err) {
            // Hashing/canonicalization should be deterministic and total over
            // any JSON-compatible payload — this branch is defense-in-depth.
            logger.warn(
              'Agent event canonicalization/hashing failed — chain columns NULL',
              {
                error: err,
                workflowId: input.workflowId,
                agent: input.agent,
                action: input.action,
              }
            );
            if (mode === 'enforce') {
              signatureKeyId = 'unsigned';
              logger.error(
                'SECURITY P1: agent event written as unsigned in enforce mode (canonicalization error)',
                {
                  workflowId: input.workflowId,
                  agent: input.agent,
                  action: input.action,
                  eventId: id,
                }
              );
            }
          }

          return tx.agentEvent.create({
            data: {
              id,
              workflowId: input.workflowId,
              taskId,
              agent: input.agent,
              action: input.action,
              data: input.data,
              level,
              timestamp,
              prevHash,
              eventHash,
              signature,
              signatureKeyId,
            },
          });
        },
        { isolationLevel: 'Serializable' }
      );
    } catch (err) {
      if (isSerializationFailure(err) && attempt < MAX_SERIALIZABLE_RETRIES - 1) {
        await new Promise((r) => setTimeout(r, 5 + Math.random() * 15));
        continue;
      }
      logger.warn('Failed to log agent event', {
        error: err,
        agent: input.agent,
        action: input.action,
        workflowId: input.workflowId,
      });
      return null;
    }
  }
  return null;
}
