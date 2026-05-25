/**
 * Payer Workflow Mapping Configuration
 *
 * Maps provider types to workflow types (medical vs behavioral_health).
 * Used by the workflow hydration service to determine which workflow
 * template to apply when an enrollment is created.
 */

import { ProviderType, WorkflowType } from '@prisma/client';

/**
 * Determines the default workflow type based on provider type.
 * Can be overridden by the user at enrollment creation time.
 */
export const PROVIDER_TYPE_TO_WORKFLOW: Record<ProviderType, WorkflowType> = {
  psychiatrist: 'medical',       // Psychiatrists enroll on medical panels
  psychologist: 'behavioral_health',
  lcsw: 'behavioral_health',
  lpc: 'behavioral_health',
  lmft: 'behavioral_health',
  pmhnp: 'behavioral_health',   // PMHNPs typically go through BH pathway
  other: 'medical',              // Default to medical; user can override
};

/**
 * Provider types that can enroll in BOTH medical and behavioral_health
 * workflows. The UI should offer a choice for these types.
 */
export const DUAL_ELIGIBLE_PROVIDER_TYPES: ProviderType[] = [
  'psychiatrist',  // Can enroll as both medical and BH
  'pmhnp',         // Some payers accept on medical panels
];

/**
 * Payers (by DB payer_name) that have NO behavioral-health workflow.
 * BH providers enrolling with these payers fall back to the medical workflow.
 *
 * Currently just UnitedHealthcare — UHC routes all BH credentialing to Optum
 * Behavioral Health (a separate payer entry with its own workflow), so a UHC
 * enrollment for a BH provider shouldn't try to use a non-existent UHC BH
 * track. The match is case-insensitive substring against PayerTrack.payerName.
 */
export const PAYER_NAMES_WITHOUT_BH_WORKFLOW: string[] = ['United Healthcare'];

/**
 * Determines which workflow type to use for a given provider type
 * and payer combination.
 *
 * Logic:
 * 1. If the user explicitly selected a workflow type, use that
 * 2. Otherwise, infer from provider type
 * 3. If the inferred type is behavioral_health and the payer doesn't have
 *    a BH workflow, fall back to medical
 */
export function resolveWorkflowType(
  providerType: ProviderType,
  payerName?: string | null,
  explicitChoice?: WorkflowType | null
): WorkflowType {
  // Explicit user choice takes priority
  if (explicitChoice) return explicitChoice;

  // eslint-disable-next-line security/detect-object-injection -- providerType is a Prisma enum; lookup map is a closed Record<ProviderType, WorkflowType>
  const defaultType = PROVIDER_TYPE_TO_WORKFLOW[providerType];

  // If the payer doesn't have a BH workflow, fall back to medical
  if (
    defaultType === 'behavioral_health' &&
    payerName &&
    PAYER_NAMES_WITHOUT_BH_WORKFLOW.some((name) =>
      payerName.toLowerCase().includes(name.toLowerCase())
    )
  ) {
    return 'medical';
  }

  return defaultType;
}
