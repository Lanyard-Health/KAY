import type { AetnaProviderData, AetnaFormPayload } from './types.js';

const DEGREE_MAP: Record<string, string> = {
  md: 'MD', do: 'DO', phd: 'PhD', psyd: 'PsyD', msw: 'MSW',
  ma: 'MA', ms: 'MS', med: 'MED', dnp: 'DNP', msn: 'MSN',
  bs: 'BS', ba: 'BA', other: 'Other',
};

export function mapDegreeToAetna(degree: string): string {
  return DEGREE_MAP[degree.toLowerCase()] ?? degree.toUpperCase();
}

/**
 * Maps internal specialty names to Aetna's dropdown labels.
 * Aetna's form populates specialties based on selected degree,
 * so these labels must match exactly.
 */
const SPECIALTY_MAP: Record<string, string> = {
  // Psychiatry / Mental Health
  'psychiatry': 'Psychiatry',
  'child and adolescent psychiatry': 'Child & Adolescent Psychiatry',
  'addiction psychiatry': 'Addiction Psychiatry',
  'geriatric psychiatry': 'Geriatric Psychiatry',
  'forensic psychiatry': 'Forensic Psychiatry',
  'clinical psychology': 'Clinical Psychology',
  'neuropsychology': 'Neuropsychology',
  'counseling': 'Counseling',
  'clinical social work': 'Clinical Social Work',
  'marriage and family therapy': 'Marriage & Family Therapy',
  'behavioral health': 'Behavioral Health',
  // Primary Care
  'family medicine': 'Family Medicine',
  'family practice': 'Family Medicine',
  'internal medicine': 'Internal Medicine',
  'general practice': 'General Practice',
  'pediatrics': 'Pediatrics',
  'geriatric medicine': 'Geriatric Medicine',
  // Medical specialties
  'cardiology': 'Cardiology',
  'dermatology': 'Dermatology',
  'endocrinology': 'Endocrinology',
  'gastroenterology': 'Gastroenterology',
  'hematology': 'Hematology',
  'infectious disease': 'Infectious Disease',
  'nephrology': 'Nephrology',
  'neurology': 'Neurology',
  'obstetrics and gynecology': 'Obstetrics & Gynecology',
  'ob/gyn': 'Obstetrics & Gynecology',
  'oncology': 'Oncology',
  'ophthalmology': 'Ophthalmology',
  'orthopedic surgery': 'Orthopedic Surgery',
  'otolaryngology': 'Otolaryngology',
  'pathology': 'Pathology',
  'physical medicine and rehabilitation': 'Physical Medicine & Rehabilitation',
  'pulmonology': 'Pulmonology',
  'radiology': 'Radiology',
  'rheumatology': 'Rheumatology',
  'surgery': 'General Surgery',
  'general surgery': 'General Surgery',
  'urology': 'Urology',
  // Nursing
  'nurse practitioner': 'Nurse Practitioner',
  'psychiatric nurse practitioner': 'Psychiatric Nurse Practitioner',
  'clinical nurse specialist': 'Clinical Nurse Specialist',
};

export function mapSpecialtyToAetna(specialty: string): string {
  return SPECIALTY_MAP[specialty.toLowerCase()] ?? specialty;
}

const STATE_ABBR_TO_NAME: Record<string, string> = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California',
  CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', DC: 'District of Columbia',
  FL: 'Florida', GA: 'Georgia', GU: 'Guam', HI: 'Hawaii', ID: 'Idaho',
  IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky',
  LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan',
  MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska',
  NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York',
  NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon',
  PA: 'Pennsylvania', PR: 'Puerto Rico', RI: 'Rhode Island', SC: 'South Carolina',
  SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont',
  VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
};

export function mapStateToFullName(abbr: string): string {
  return STATE_ABBR_TO_NAME[abbr.toUpperCase()] ?? abbr;
}

export function mapTaxIdType(taxId: string): string {
  // EIN format: XX-XXXXXXX (2 digits, dash, 7 digits)
  if (/^\d{2}-\d{7}$/.test(taxId)) return 'E - Employer identification number';
  // SSN format: XXX-XX-XXXX
  if (/^\d{3}-\d{2}-\d{4}$/.test(taxId)) return 'S - Social Security number';
  // Default to EIN for raw 9-digit or other formats
  return 'E - Employer identification number';
}

function formatDate(date: Date): string {
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const y = date.getFullYear();
  return `${m}/${d}/${y}`;
}

function formatLicenseExpiration(date: Date): string {
  return formatDate(date);
}

export function mapProviderToAetnaPayload(data: AetnaProviderData): AetnaFormPayload {
  const { provider, practice, primaryLocation, primaryLicense, education, hospitalAffiliations, submitter, aetnaOverrides } = data;
  const loc = primaryLocation;
  const taxId = loc?.taxId ?? '';
  const overrides = aetnaOverrides ?? {};

  return {
    gateway: {
      network: 'Aetna',
      category: 'MED',
      subcategory: overrides.existingAetnaProvider
        ? 'existing group practice'
        : 'new individual provider',
    },

    // Page 2: Submitter Information
    page2: {
      lastName: submitter.lastName,
      firstName: submitter.firstName,
      role: 'Credentialing / Enrollment (Director, Manager, Coordinator)',
      email: submitter.email,
      verifyEmail: submitter.email,
      phoneNumber: submitter.phone,
      ext: '',
      faxNumber: provider.fax ?? '',
      newNpiId: provider.npi,
      emailAcknowledgement: 'Agree',
      checkboxSelect: 'true',
    },

    // Page 3: Network & Tax Information
    page3: {
      teleHealthService: 'No',
      networkJoining: overrides.networkJoining ?? 'As a new individual provider',
      applicableSituation: overrides.applicableSituation ?? 'I want to be contracted in the state selected below',
      state: loc?.state ? mapStateToFullName(loc.state) : '',
      zipCode: loc?.zipCode ?? '',
      ext: '',
      mnapplicant: 'no',
      taxIdType: taxId ? mapTaxIdType(taxId) : '',
      taxIDName: practice?.name ?? '',
      taxID: taxId.replace(/\D/g, ''),
      verifyTaxID: taxId.replace(/\D/g, ''),
      practLastName: provider.lastName,
      practFirstName: provider.firstName,
      npi: provider.npi,
      checkboxSelect: 'true',
    },

    // Page 4: Degree & Specialty
    page4: {
      degreeType: education?.degree ? mapDegreeToAetna(education.degree) : '',
      specialty: provider.specialties[0] ? mapSpecialtyToAetna(provider.specialties[0]) : '',
      providerClassification: overrides.providerClassification ?? 'Specialist',
      checkboxSelect: 'true',
    },

    // Page 5: Provider Details & Credentials
    page5: {
      lastName: provider.lastName,
      firstName: provider.firstName,
      middleInitial: provider.middleName ?? '',
      dob: formatDate(provider.dateOfBirth),
      state: primaryLicense?.state ?? '',
      medicalLicenseNumber: primaryLicense?.licenseNumber ?? '',
      medLicenseExpDate: primaryLicense ? formatLicenseExpiration(primaryLicense.expirationDate) : '',
      caqhID: provider.caqhProviderId ?? '',
      providerURL: practice?.website ?? '',
      acceptingNewPatients: loc?.acceptingNewPatients ? 'Yes' : 'No',
      electronicPrescribing: provider.ePrescribing ? 'Yes' : 'No',
    },

    // Page 6: Contact Preferences
    page6: {
      contractingContact: 'Submitter',
      preferredContactMethod: 'Email',
      authorizedContact: 'Submitter',
    },

    // Page 7: Primary Practice Location
    page7: {
      street: loc?.addressLine1 ?? '',
      street2: loc?.addressLine2 ?? '',
      city: loc?.city ?? '',
      state: loc?.state ?? '',
      zipcode: loc?.zipCode ?? '',
      ext: '',
      county: loc?.county ?? '',
      phoneNumber: loc?.phone ?? '',
      phoneExt: '',
      faxNumber: loc?.fax ?? '',
      languages: (loc?.languagesSpoken ?? []).join(', '),
      workingDays: overrides.workingDays ?? 'WEEKDAYS ONLY (MONDAY-FRIDAY)',
      otherTelehealth: '',
      checkboxAttest: 'true',
    },

    // Page 8: Mailing & Billing Addresses
    page8: {
      mailingAddress: 'Same as primary address',
      billingAddress: loc?.billingAddressLine1
        ? 'New billing address'
        : 'Same as primary address',
      ...(loc?.billingAddressLine1 ? {
        billingStreet: loc.billingAddressLine1,
        billingCity: loc.billingCity ?? '',
        billingState: loc.billingState ?? '',
        billingZipCode: loc.billingZipCode ?? '',
      } : {}),
    },

    // Page 9: Hospital Privileges & Attachments
    page9: {
      hospitalPrivileges: hospitalAffiliations.some(a => a.privilegeType === 'admitting' && a.status === 'active') ? 'Yes' : 'No',
      facilityBased: 'No',
    },

    // Page 10: Additional Questions & Final Review
    page10: {
      medicareCertified: provider.acceptingMedicare ? 'Yes' : 'No',
      medicaidCertified: provider.acceptingMedicaid ? 'Yes' : 'No',
      aetnaEAPProgram: 'No',
      americanSignLanguage: 'No',
    },
  };
}

/**
 * Mask sensitive fields for storage in formPayload.
 * Real values are used during form fill; masked values are persisted.
 */
export function maskSensitivePayload(payload: AetnaFormPayload): AetnaFormPayload {
  const masked = JSON.parse(JSON.stringify(payload)) as AetnaFormPayload;
  if (masked.page3['taxID']) {
    const raw = masked.page3['taxID'] as string;
    masked.page3['taxID'] = `***-***-${raw.slice(-4)}`;
    masked.page3['verifyTaxID'] = masked.page3['taxID'];
  }
  return masked;
}
