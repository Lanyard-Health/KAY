import { registerAdapter } from './payer-adapter.js';
import { CaqhDirectAssureAdapter } from './caqh-adapter.js';
import { ManualSubmissionAdapter } from './manual-adapter.js';
import { AvailityAdapter } from './availity-adapter.js';

export function registerPortalAdapters(): void {
  registerAdapter('caqh_directassure', new CaqhDirectAssureAdapter());
  registerAdapter('manual_submission', new ManualSubmissionAdapter());
  // Demo-only adapter — drives a local fake-Availity portal for browser-automation demos.
  // Gated behind NODE_ENV at the static-middleware layer; in production NODE_ENV='production'
  // the mock site doesn't load, so this adapter has nothing to drive.
  if (process.env['NODE_ENV'] !== 'production') {
    registerAdapter('availity_demo', new AvailityAdapter());
  }
}

export { getAdapter, listAdapterTypes, clearAdapters } from './payer-adapter.js';
export { processPortalJob } from './portal-agent.js';
export type { PortalJobData } from './portal-agent.js';
