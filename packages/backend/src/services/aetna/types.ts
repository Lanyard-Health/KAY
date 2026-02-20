/**
 * Shape of data loaded from Prisma for one provider enrollment.
 * Passed to the field mapper and readiness checker.
 */
export interface AetnaProviderData {
  provider: {
    id: string;
    npi: string;
    firstName: string;
    lastName: string;
    middleName: string | null;
    dateOfBirth: Date;
    gender: string;
    email: string;
    phone: string;
    fax: string | null;
    providerType: string;
    specialties: string[];
    languages: string[];
    caqhProviderId: string | null;
    acceptingMedicare: boolean;
    acceptingMedicaid: boolean;
    ePrescribing: boolean;
    ssnEncrypted: string | null;
  };
  practice: {
    id: string;
    name: string;
    phone: string | null;
    email: string | null;
    website: string | null;
  } | null;
  primaryLocation: {
    addressLine1: string;
    addressLine2: string | null;
    city: string;
    state: string;
    zipCode: string;
    county: string | null;
    phone: string;
    fax: string | null;
    taxId: string | null;
    groupNpi: string | null;
    acceptingNewPatients: boolean;
    languagesSpoken: string[];
    officeHours: Record<string, unknown> | null;
    billingAddressLine1: string | null;
    billingCity: string | null;
    billingState: string | null;
    billingZipCode: string | null;
  } | null;
  primaryLicense: {
    licenseNumber: string;
    state: string | null;
    expirationDate: Date;
  } | null;
  education: {
    degree: string;
  } | null;
  hospitalAffiliations: Array<{
    facilityName: string;
    privilegeType: string;
    status: string;
  }>;
  submitter: {
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
  };
  /** Optional overrides for Aetna-specific business fields */
  aetnaOverrides?: {
    existingAetnaProvider?: boolean;
    networkJoining?: string;
    applicableSituation?: string;
    providerClassification?: string;
    workingDays?: string;
  };
}

/** Flat map of formcontrolname → value for each Aetna form page */
export interface AetnaFormPayload {
  gateway: { network: string; category: string; subcategory: string };
  page2: Record<string, string | boolean>;
  page3: Record<string, string | boolean>;
  page4: Record<string, string | boolean>;
  page5: Record<string, string | boolean>;
  page6: Record<string, string | boolean>;
  page7: Record<string, string | boolean>;
  page8: Record<string, string | boolean>;
  page9: Record<string, string | boolean>;
  page10: Record<string, string | boolean>;
}

/** Readiness check result */
export interface ReadinessResult {
  ready: boolean;
  pages: Array<{
    page: number;
    title: string;
    ready: boolean;
    missing: Array<{
      field: string;
      label: string;
      fixPath: string;
    }>;
  }>;
}

/** Run status returned to frontend */
export interface AetnaRunStatusResponse {
  id: string;
  status: string;
  aetnaRequestId: string | null;
  screenshotUrls: string[];
  automationLog: string | null;
  errorMessage: string | null;
  errorPage: number | null;
  startedAt: string | null;
  reviewExpiresAt: string | null;
  submittedAt: string | null;
  completedAt: string | null;
  confirmationPdfUrl: string | null;
}
