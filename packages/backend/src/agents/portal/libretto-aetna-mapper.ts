/**
 * Map Lanyard's Aetna packet -> the flat params the Libretto `aetnaRfpBehavioralHealth`
 * workflow expects.
 *
 * The packet (`AetnaRfpProviderData`, built by `aetna-rfp-resolver.ts`) is nested;
 * the Libretto workflow's input schema is flat. This is a pure reshape — flatten,
 * rename, and convert two enums to their on-form dropdown labels. No I/O, no PII
 * leaves anywhere; this just transforms an object.
 *
 * Source of truth for the workflow's field names: the `inputSchema` in
 * `aetna-rfp-workflow.ts` (deployed to Libretto as `aetnaRfpBehavioralHealth`).
 */

import type {
  AetnaRfpProviderData,
  AetnaLineOfBusiness,
  AetnaJoining,
} from './aetna-rfp-adapter.js';

/** Flat param object accepted by the Libretto `aetnaRfpBehavioralHealth` workflow. */
export interface LibrettoAetnaParams {
  payer: string;
  applyingFor: string;
  joining: string;

  submitterLast: string;
  submitterFirst: string;
  submitterRole: string;
  submitterEmail: string;
  submitterPhone: string;

  providerLast: string;
  providerFirst: string;
  npi: string;
  taxIdType: 'E' | 'S';
  taxIdName: string;
  taxId: string;
  caqhId: string;
  dob: string;
  licenseNumber: string;
  licenseExp: string;
  degree: string;
  primarySpecialty: string;

  state: string;
  zip: string;
  street: string;
  city: string;
  locationPhone: string;
  locationFax: string;

  telehealth: 'Yes' | 'No';
  ageGroup: string;
  practiceFocus: string;

  confirmSubmit: boolean;
}

// These mirror the (un-exported) label maps in aetna-rfp-adapter.ts. Kept local so
// the mapper doesn't reach into the adapter's internals; if Aetna changes a dropdown
// label, update both. The adapter is the source of truth for the on-form text.
const APPLYING_FOR_LABEL: Record<AetnaLineOfBusiness, string> = {
  BEHAVIORAL_HEALTH: 'Behavioral Health',
  MEDICAL: 'Medical',
  DENTAL: 'Dental',
  FACILITY: 'Facility',
  PHARMACY: 'Pharmacy & Medicare Part D',
};

const JOINING_LABEL: Record<AetnaJoining, string> = {
  INDIVIDUAL_NEW:
    'A individual provider applying under a SSN or TaxID/EIN that is not currently participating with Aetna',
  GROUP_NEW:
    'A provider group applying under a SSN or TaxID/EIN that is not currently participating with Aetna',
  EXISTING:
    'A provider applying under a SSN or TaxID/EIN that is currently participating with Aetna',
};

/**
 * @param packet  the resolved Aetna data (already passed the resolver's completeness gate)
 * @param opts.confirmSubmit  whether the workflow may click the real Submit button (default false)
 */
export function aetnaPacketToLibrettoParams(
  packet: AetnaRfpProviderData,
  opts: { confirmSubmit?: boolean } = {}
): LibrettoAetnaParams {
  const { submitter, provider, location, behavioralHealth } = packet;

  return {
    payer: packet.payer,
    applyingFor: APPLYING_FOR_LABEL[packet.lineOfBusiness],
    joining: JOINING_LABEL[packet.joining],

    submitterLast: submitter.lastName,
    submitterFirst: submitter.firstName,
    submitterRole: submitter.role,
    submitterEmail: submitter.email,
    submitterPhone: submitter.phone,

    providerLast: provider.lastName,
    providerFirst: provider.firstName,
    npi: provider.npi,
    taxIdType: provider.taxIdType,
    taxIdName: provider.taxIdName,
    taxId: provider.taxId,
    caqhId: provider.caqhId,
    dob: provider.dob,
    licenseNumber: provider.licenseNumber,
    licenseExp: provider.licenseExp,
    degree: provider.degree,
    primarySpecialty: provider.primarySpecialty,

    state: location.state,
    zip: location.zip,
    street: location.street,
    city: location.city,
    locationPhone: location.phone,
    locationFax: location.fax,

    telehealth: packet.telehealth ? 'Yes' : 'No',
    // ponytail: the Libretto workflow selects ONE age group / focus (single string),
    // but Lanyard supports multiple. Take the first until the workflow handles arrays.
    ageGroup: behavioralHealth?.ageGroup?.[0] ?? '',
    practiceFocus: behavioralHealth?.practiceFocus?.[0] ?? '',

    confirmSubmit: opts.confirmSubmit ?? false,
  };
}
