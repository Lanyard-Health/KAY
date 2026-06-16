import type { AdapterType } from '@prisma/client';
import {
  AdapterNotRegisteredError,
  type SubmissionPortalAdapter,
} from './submission-adapter.js';

/**
 * AdapterFactory — single source of truth for resolving a SubmissionPortalAdapter
 * from a Payer's adapterType. No code outside this file may instantiate an
 * adapter directly. Callers must go through `getSubmissionAdapter(type)`.
 *
 * Phase 3: real CAQH (REST/XML via CaqhService) + MANUAL (creates
 * PendingApproval) are registered. AETNA_RFP (Playwright, public Aetna RFP
 * wizard) is the first real portal adapter. PLAYWRIGHT_GENERIC + AVAILITY land
 * in later phases. FAX is registered in Phase 4 (vendor DPA must clear first).
 *
 * Tests can override registrations via `registerSubmissionAdapter()` and
 * reset via `clearSubmissionAdapters()`.
 */
const registry = new Map<AdapterType, SubmissionPortalAdapter>();

export function registerSubmissionAdapter(
  type: AdapterType,
  adapter: SubmissionPortalAdapter
): void {
  registry.set(type, adapter);
}

export function getSubmissionAdapter(type: AdapterType): SubmissionPortalAdapter {
  const adapter = registry.get(type);
  if (!adapter) {
    throw new AdapterNotRegisteredError(type);
  }
  return adapter;
}

export function listRegisteredAdapterTypes(): AdapterType[] {
  return Array.from(registry.keys());
}

export function clearSubmissionAdapters(): void {
  registry.clear();
}

// ─── Default registration ───────────────────────────────────────────────

import { CaqhSubmissionAdapter } from './caqh-submission-adapter.js';
import { ManualSubmissionAdapter } from './manual-submission-adapter.js';
import { AetnaRfpAdapter } from './aetna-rfp-adapter.js';

/**
 * Registers the production adapter set. Idempotent — safe to call multiple
 * times. Called once at server startup from workers.ts (alongside the legacy
 * registerPortalAdapters from index.ts, which still owns the legacy pipeline).
 */
export function registerSubmissionAdapters(): void {
  registerSubmissionAdapter('CAQH', new CaqhSubmissionAdapter());
  registerSubmissionAdapter('MANUAL', new ManualSubmissionAdapter());
  registerSubmissionAdapter('AETNA_RFP', new AetnaRfpAdapter());
}
