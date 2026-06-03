import { registerAdapter } from './payer-adapter.js';
import { CaqhDirectAssureAdapter } from './caqh-adapter.js';
import { ManualSubmissionAdapter } from './manual-adapter.js';

export function registerPortalAdapters(): void {
  registerAdapter('caqh_directassure', new CaqhDirectAssureAdapter());
  registerAdapter('manual_submission', new ManualSubmissionAdapter());
}

export { getAdapter, listAdapterTypes, clearAdapters } from './payer-adapter.js';
export { processPortalJob } from './portal-agent.js';
export type { PortalJobData } from './portal-agent.js';
