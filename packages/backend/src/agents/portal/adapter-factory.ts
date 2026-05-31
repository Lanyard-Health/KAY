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
 * Phase 1: only CAQH and MANUAL stubs are registered. Real adapters
 * (PLAYWRIGHT_GENERIC, AETNA_BH, AVAILITY) land in later phases. FAX is
 * registered in Phase 4 (vendor DPA must clear first).
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

// ─── Phase 1 stubs ──────────────────────────────────────────────────────

import {
  CaqhSubmissionAdapterStub,
  ManualSubmissionAdapterStub,
} from './phase1-stubs.js';

/**
 * Registers the Phase 1 adapter set. Idempotent — safe to call multiple
 * times. Called once at server startup from src/index.ts (alongside the
 * legacy registerPortalAdapters from index.ts).
 */
export function registerPhase1Adapters(): void {
  registerSubmissionAdapter('CAQH', new CaqhSubmissionAdapterStub());
  registerSubmissionAdapter('MANUAL', new ManualSubmissionAdapterStub());
}
