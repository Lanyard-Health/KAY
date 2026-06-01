import type { AdapterType } from '@prisma/client';
import type { ResolvedCredential } from '../../services/credential.service.js';

/**
 * SubmissionPortalAdapter — the contract every adapter (CAQH, Playwright
 * portal bots, fax, manual) must implement in the new submission pipeline.
 *
 * This is the replacement for the legacy PayerAdapter in payer-adapter.ts.
 * The legacy interface accepted Record<string, unknown> credentials; the new
 * one accepts a typed `ResolvedCredential` struct from credential.service so
 * decryption stays in one place and adapters cannot accidentally log or
 * persist plaintext.
 *
 * Adapters MUST NOT call decryptForTenant directly. They receive plaintext
 * via the `credential` parameter and the caller is responsible for invoking
 * `credential.wipe()` after the call returns.
 */
export interface SubmissionPortalAdapter {
  readonly adapterType: AdapterType;
  submit(
    input: SubmissionAdapterInput,
    credential: ResolvedCredential
  ): Promise<SubmissionResult>;
}

export interface SubmissionAdapterInput {
  enrollmentRunId: string;
  payerId: string;
  practiceId: string;
  providerId: string;
  /**
   * Provider application data — the resolved field set built by the
   * recipe-resolver for this payer's form. Shape is intentionally `unknown`
   * here so adapters can narrow to their payer-specific schema.
   */
  providerData: unknown;
}

export interface SubmissionResult {
  success: boolean;
  confirmationNumber?: string;
  externalReference?: string;
  /** S3 key of pre-submission screenshot — populated by PlaywrightBaseAdapter. */
  preScreenshotKey?: string;
  /** S3 key of post-submission confirmation screenshot. */
  postScreenshotKey?: string;
  /** Raw response text or HTML, for audit/debugging. Must NOT contain credentials. */
  rawResponseText?: string;
  errorMessage?: string;
  errorCode?: string;
}

export class AdapterNotRegisteredError extends Error {
  constructor(public readonly adapterType: AdapterType) {
    super(`No SubmissionPortalAdapter registered for adapterType=${adapterType}`);
    this.name = 'AdapterNotRegisteredError';
  }
}
