/**
 * Email Classifier Worker (v1 — fixture-driven)
 *
 * Reads payer credentialing emails (from JSON fixtures in v1; IMAP in v2),
 * uses Claude to classify each as approval / denial / info-needed / other,
 * and POSTs accepted classifications to the enrollment-status webhook
 * (PR #250). The webhook handles the rest — DenialTriage creation,
 * status update, WebSocket fan-out, audit logging.
 *
 * v1 deliberately ships **fixture mode only** so the demo works without
 * setting up Gmail/IMAP credentials. Real IMAP polling is a v2 follow-up
 * that drops a second source module in alongside the fixture loader.
 *
 * Environment:
 *   ANTHROPIC_API_KEY         (required) — Claude classification
 *   ENROLLMENT_WEBHOOK_SECRET (required) — HMAC signing for the webhook
 *   WEBHOOK_BASE_URL          (optional, default http://localhost:3002) — webhook target
 *   AI_MODEL                  (optional, default claude-haiku-4-5-20251001)
 *
 * Usage:
 *   npx tsx scripts/email-classifier.ts                          # process every fixture
 *   npx tsx scripts/email-classifier.ts --fixture availity-denial # process one
 *   npx tsx scripts/email-classifier.ts --dry-run                # classify but don't post
 *
 * Confidence threshold:
 *   Auto-posts to webhook only when Claude returns confidence: 'high'.
 *   'medium' and 'low' classifications are logged but skipped — humans
 *   review those in the Lanyard UI before any state change.
 */

import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';

// ──────────────────────────────────────────────
// Config
// ──────────────────────────────────────────────

const FIXTURES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'email-fixtures');
const WEBHOOK_BASE_URL = process.env['WEBHOOK_BASE_URL'] ?? 'http://localhost:3002';
const WEBHOOK_PATH = '/api/v1/webhooks/enrollment-status';
const AI_MODEL = process.env['AI_MODEL'] ?? 'claude-haiku-4-5-20251001';

const argv = process.argv.slice(2);
const DRY_RUN = argv.includes('--dry-run');
const FIXTURE_FILTER = (() => {
  const i = argv.indexOf('--fixture');
  return i !== -1 ? argv[i + 1] : null;
})();

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

interface EmailFixture {
  messageId: string;
  from: string;
  to: string;
  subject: string;
  receivedAt: string;
  body: string;
}

type ClassificationStatus = 'approved' | 'denied' | 'additional_info_needed' | 'other';
type ConfidenceLevel = 'high' | 'medium' | 'low';

interface Classification {
  isPayerResponse: boolean;
  status: ClassificationStatus;
  payerName: string | null;
  providerNpi: string | null;
  providerName: string | null;
  denialReason: string | null;
  confirmationId: string | null;
  effectiveDate: string | null;
  confidence: ConfidenceLevel;
  reasoning: string;
}

// ──────────────────────────────────────────────
// Anthropic client
// ──────────────────────────────────────────────

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!client) {
    const apiKey = process.env['ANTHROPIC_API_KEY'];
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set in env');
    client = new Anthropic({ apiKey, timeout: 30_000 });
  }
  return client;
}

// ──────────────────────────────────────────────
// Step 1 — classify with Claude
// ──────────────────────────────────────────────

const SYSTEM_PROMPT = `You read healthcare credentialing emails and classify them.

Return ONE LINE of JSON, no prose, no code fences. Schema:
{
  "isPayerResponse": boolean,         // true only if this is from a payer about credentialing
  "status": "approved" | "denied" | "additional_info_needed" | "other",
  "payerName": string | null,         // the payer / insurance company name
  "providerNpi": string | null,       // 10-digit NPI if mentioned
  "providerName": string | null,      // provider's name as written in email
  "denialReason": string | null,      // brief reason if denied or info-needed
  "confirmationId": string | null,    // any provider/network ID assigned on approval
  "effectiveDate": string | null,     // ISO date if provided
  "confidence": "high" | "medium" | "low",
  "reasoning": string                 // ≤120 chars: why you classified this way
}

Confidence rules:
- "high" — the email clearly states the outcome AND identifies the provider (NPI or full name) AND identifies the payer.
- "medium" — outcome is clear but provider OR payer identification is ambiguous.
- "low" — uncertain whether this is a credentialing email at all, or status is unclear.

Status rules:
- "approved" — application accepted; provider is now in-network or otherwise credentialed.
- "denied" — application rejected with a reason that won't be remediated by submitting more info.
- "additional_info_needed" — application is on hold pending submission of additional docs/info.
- "other" — anything else (newsletter, reminder, irrelevant).

Set isPayerResponse=false if the email is not a credentialing-related message (e.g., marketing, non-credentialing notification). In that case all other fields can be null and status="other".`;

async function classifyEmail(email: EmailFixture): Promise<Classification> {
  const userMessage = [
    `From: ${email.from}`,
    `To: ${email.to}`,
    `Subject: ${email.subject}`,
    `Received: ${email.receivedAt}`,
    '',
    email.body,
  ].join('\n');

  const response = await getClient().messages.create({
    model: AI_MODEL,
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMessage }],
  });

  const textBlock = response.content.find((b) => b.type === 'text');
  const raw = textBlock && 'text' in textBlock ? textBlock.text.trim() : '';

  // Strip code fences if Claude added them despite instructions.
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '');

  try {
    return JSON.parse(cleaned) as Classification;
  } catch {
    throw new Error(`Failed to parse Claude response as JSON: ${raw.slice(0, 200)}`);
  }
}

// ──────────────────────────────────────────────
// Step 2 — resolve payer + enrollment from classification
// ──────────────────────────────────────────────

const prisma = new PrismaClient();

async function resolveEnrollment(c: Classification): Promise<
  | { ok: true; enrollmentId: string; providerNpi: string; payerExternalId: string }
  | { ok: false; reason: string }
> {
  if (!c.providerNpi) return { ok: false, reason: 'No provider NPI in email' };
  if (!c.payerName) return { ok: false, reason: 'No payer name in email' };

  // Find a payer whose name fuzzy-matches what Claude extracted.
  // contains/insensitive — robust to minor wording differences.
  const payer = await prisma.payer.findFirst({
    where: { name: { contains: c.payerName, mode: 'insensitive' } },
    select: { id: true, payerId: true, name: true },
  });
  if (!payer) return { ok: false, reason: `No payer in DB matches "${c.payerName}"` };

  // Resolve enrollment via provider NPI + payer.
  const enrollment = await prisma.enrollment.findFirst({
    where: {
      provider: { npi: c.providerNpi },
      payerId: payer.id,
    },
    select: { id: true },
  });
  if (!enrollment) {
    return {
      ok: false,
      reason: `No enrollment for NPI ${c.providerNpi} + payer ${payer.name}`,
    };
  }

  return {
    ok: true,
    enrollmentId: enrollment.id,
    providerNpi: c.providerNpi,
    payerExternalId: payer.payerId,
  };
}

// ──────────────────────────────────────────────
// Step 3 — sign + POST to the webhook
// ──────────────────────────────────────────────

interface WebhookPayload {
  enrollmentId: string;
  status: 'approved' | 'denied' | 'additional_info_needed';
  denialReason?: string;
  effectiveDate?: string;
  confirmationId?: string;
  source: string;
}

async function postToWebhook(payload: WebhookPayload): Promise<{ ok: boolean; httpStatus: number; body: unknown }> {
  const secret = process.env['ENROLLMENT_WEBHOOK_SECRET'];
  if (!secret) throw new Error('ENROLLMENT_WEBHOOK_SECRET is not set in env');

  const body = JSON.stringify(payload);
  const ts = new Date().toISOString();
  const sig = crypto.createHmac('sha256', secret).update(body).digest('hex');

  const res = await fetch(`${WEBHOOK_BASE_URL}${WEBHOOK_PATH}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Webhook-Signature': sig,
      'X-Webhook-Timestamp': ts,
    },
    body,
  });

  let responseBody: unknown = null;
  try { responseBody = await res.json(); } catch { /* swallow */ }

  return { ok: res.ok, httpStatus: res.status, body: responseBody };
}

// ──────────────────────────────────────────────
// Driver
// ──────────────────────────────────────────────

function loadFixtures(filter: string | null): Array<{ name: string; email: EmailFixture }> {
  if (!fs.existsSync(FIXTURES_DIR)) {
    throw new Error(`Fixtures directory not found: ${FIXTURES_DIR}`);
  }
  const files = fs.readdirSync(FIXTURES_DIR).filter((f) => f.endsWith('.json'));
  return files
    .filter((f) => !filter || f.startsWith(filter))
    .map((f) => ({
      name: f.replace(/\.json$/, ''),
      email: JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, f), 'utf8')) as EmailFixture,
    }));
}

async function processFixture(name: string, email: EmailFixture): Promise<void> {
  console.log(`\n─── ${name} ───`);
  console.log(`  Subject: ${email.subject}`);
  console.log(`  From:    ${email.from}`);

  const t0 = Date.now();
  const cls = await classifyEmail(email);
  console.log(`  Classified in ${Date.now() - t0}ms:`);
  console.log(`    isPayerResponse: ${cls.isPayerResponse}`);
  console.log(`    status:          ${cls.status}`);
  console.log(`    payer:           ${cls.payerName ?? '—'}`);
  console.log(`    providerNpi:     ${cls.providerNpi ?? '—'}`);
  console.log(`    confidence:      ${cls.confidence}`);
  console.log(`    reasoning:       ${cls.reasoning}`);

  if (!cls.isPayerResponse) {
    console.log(`  → SKIP (not a payer credentialing email)`);
    return;
  }
  if (cls.confidence !== 'high') {
    console.log(`  → SKIP (confidence ${cls.confidence}; auto-post requires "high")`);
    return;
  }
  if (cls.status === 'other') {
    console.log(`  → SKIP (status "other")`);
    return;
  }

  const resolved = await resolveEnrollment(cls);
  if (!resolved.ok) {
    console.log(`  → SKIP (${resolved.reason})`);
    return;
  }
  console.log(`  Resolved enrollmentId: ${resolved.enrollmentId}`);

  const payload: WebhookPayload = {
    enrollmentId: resolved.enrollmentId,
    status: cls.status,
    source: `email-classifier:${email.messageId}`,
  };
  if (cls.denialReason) payload.denialReason = cls.denialReason;
  if (cls.effectiveDate) payload.effectiveDate = cls.effectiveDate;
  if (cls.confirmationId) payload.confirmationId = cls.confirmationId;

  if (DRY_RUN) {
    console.log(`  → DRY RUN — would POST:`, payload);
    return;
  }

  const result = await postToWebhook(payload);
  if (result.ok) {
    console.log(`  → POSTED — webhook returned ${result.httpStatus}:`, result.body);
  } else {
    console.log(`  → FAILED — webhook returned ${result.httpStatus}:`, result.body);
  }
}

async function main(): Promise<void> {
  console.log('Email Classifier Worker (v1 fixture mode)');
  console.log(`  Webhook target: ${WEBHOOK_BASE_URL}${WEBHOOK_PATH}`);
  console.log(`  Model:          ${AI_MODEL}`);
  console.log(`  Mode:           ${DRY_RUN ? 'DRY RUN (no posts)' : 'LIVE'}`);

  const fixtures = loadFixtures(FIXTURE_FILTER);
  if (fixtures.length === 0) {
    console.log(`No fixtures found${FIXTURE_FILTER ? ` matching "${FIXTURE_FILTER}"` : ''}.`);
    return;
  }

  console.log(`  Fixtures:       ${fixtures.length}`);

  for (const { name, email } of fixtures) {
    try {
      await processFixture(name, email);
    } catch (err) {
      console.error(`  → ERROR:`, err instanceof Error ? err.message : err);
    }
  }

  console.log('\nDone.');
}

main()
  .catch((err) => {
    console.error('Email classifier failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
