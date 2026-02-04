// US States
export const US_STATES = [
  { code: 'AL', name: 'Alabama' },
  { code: 'AK', name: 'Alaska' },
  { code: 'AZ', name: 'Arizona' },
  { code: 'AR', name: 'Arkansas' },
  { code: 'CA', name: 'California' },
  { code: 'CO', name: 'Colorado' },
  { code: 'CT', name: 'Connecticut' },
  { code: 'DE', name: 'Delaware' },
  { code: 'DC', name: 'District of Columbia' },
  { code: 'FL', name: 'Florida' },
  { code: 'GA', name: 'Georgia' },
  { code: 'HI', name: 'Hawaii' },
  { code: 'ID', name: 'Idaho' },
  { code: 'IL', name: 'Illinois' },
  { code: 'IN', name: 'Indiana' },
  { code: 'IA', name: 'Iowa' },
  { code: 'KS', name: 'Kansas' },
  { code: 'KY', name: 'Kentucky' },
  { code: 'LA', name: 'Louisiana' },
  { code: 'ME', name: 'Maine' },
  { code: 'MD', name: 'Maryland' },
  { code: 'MA', name: 'Massachusetts' },
  { code: 'MI', name: 'Michigan' },
  { code: 'MN', name: 'Minnesota' },
  { code: 'MS', name: 'Mississippi' },
  { code: 'MO', name: 'Missouri' },
  { code: 'MT', name: 'Montana' },
  { code: 'NE', name: 'Nebraska' },
  { code: 'NV', name: 'Nevada' },
  { code: 'NH', name: 'New Hampshire' },
  { code: 'NJ', name: 'New Jersey' },
  { code: 'NM', name: 'New Mexico' },
  { code: 'NY', name: 'New York' },
  { code: 'NC', name: 'North Carolina' },
  { code: 'ND', name: 'North Dakota' },
  { code: 'OH', name: 'Ohio' },
  { code: 'OK', name: 'Oklahoma' },
  { code: 'OR', name: 'Oregon' },
  { code: 'PA', name: 'Pennsylvania' },
  { code: 'PR', name: 'Puerto Rico' },
  { code: 'RI', name: 'Rhode Island' },
  { code: 'SC', name: 'South Carolina' },
  { code: 'SD', name: 'South Dakota' },
  { code: 'TN', name: 'Tennessee' },
  { code: 'TX', name: 'Texas' },
  { code: 'UT', name: 'Utah' },
  { code: 'VT', name: 'Vermont' },
  { code: 'VA', name: 'Virginia' },
  { code: 'VI', name: 'Virgin Islands' },
  { code: 'WA', name: 'Washington' },
  { code: 'WV', name: 'West Virginia' },
  { code: 'WI', name: 'Wisconsin' },
  { code: 'WY', name: 'Wyoming' },
] as const;

// Provider types for behavioral/mental health
export const PROVIDER_TYPES = [
  { value: 'psychiatrist', label: 'Psychiatrist (MD/DO)' },
  { value: 'psychologist', label: 'Psychologist (PhD/PsyD)' },
  { value: 'lcsw', label: 'Licensed Clinical Social Worker (LCSW)' },
  { value: 'lpc', label: 'Licensed Professional Counselor (LPC)' },
  { value: 'lmft', label: 'Licensed Marriage & Family Therapist (LMFT)' },
  { value: 'pmhnp', label: 'Psychiatric Mental Health Nurse Practitioner (PMHNP)' },
  { value: 'other', label: 'Other' },
] as const;

// License types
export const LICENSE_TYPES = [
  { value: 'state_medical', label: 'State Medical License' },
  { value: 'state_psychology', label: 'State Psychology License' },
  { value: 'state_social_work', label: 'State Social Work License' },
  { value: 'state_counseling', label: 'State Counseling License' },
  { value: 'state_marriage_family', label: 'State Marriage & Family Therapy License' },
  { value: 'dea', label: 'DEA Registration' },
  { value: 'controlled_substance', label: 'Controlled Substance Registration' },
  { value: 'npi', label: 'NPI Registration' },
] as const;

// Board certifications
export const BOARD_TYPES = [
  { value: 'abpn_psychiatry', label: 'ABPN - Psychiatry' },
  { value: 'abpn_child_adolescent', label: 'ABPN - Child & Adolescent Psychiatry' },
  { value: 'abpn_addiction', label: 'ABPN - Addiction Psychiatry' },
  { value: 'abpp_clinical', label: 'ABPP - Clinical Psychology' },
  { value: 'abpp_counseling', label: 'ABPP - Counseling Psychology' },
  { value: 'abecsw', label: 'ABECSW - Board Certified Expert in Clinical Social Work' },
  { value: 'nbcc', label: 'NBCC - National Certified Counselor' },
  { value: 'aamft', label: 'AAMFT - Approved Supervisor' },
  { value: 'ancc_pmhnp', label: 'ANCC - Psychiatric-Mental Health NP' },
  { value: 'other', label: 'Other' },
] as const;

// Degree types
export const DEGREE_TYPES = [
  { value: 'md', label: 'Doctor of Medicine (MD)' },
  { value: 'do', label: 'Doctor of Osteopathic Medicine (DO)' },
  { value: 'phd', label: 'Doctor of Philosophy (PhD)' },
  { value: 'psyd', label: 'Doctor of Psychology (PsyD)' },
  { value: 'msw', label: 'Master of Social Work (MSW)' },
  { value: 'ma', label: 'Master of Arts (MA)' },
  { value: 'ms', label: 'Master of Science (MS)' },
  { value: 'med', label: 'Master of Education (MEd)' },
  { value: 'dnp', label: 'Doctor of Nursing Practice (DNP)' },
  { value: 'msn', label: 'Master of Science in Nursing (MSN)' },
  { value: 'bs', label: 'Bachelor of Science (BS)' },
  { value: 'ba', label: 'Bachelor of Arts (BA)' },
  { value: 'other', label: 'Other' },
] as const;

// Document types
export const DOCUMENT_TYPES = [
  { value: 'license', label: 'License' },
  { value: 'board_certification', label: 'Board Certification' },
  { value: 'malpractice_certificate', label: 'Malpractice Insurance Certificate' },
  { value: 'diploma', label: 'Diploma' },
  { value: 'transcript', label: 'Transcript' },
  { value: 'cv_resume', label: 'CV / Resume' },
  { value: 'photo', label: 'Professional Photo' },
  { value: 'government_id', label: 'Government ID' },
  { value: 'dea_certificate', label: 'DEA Certificate' },
  { value: 'cds_certificate', label: 'Controlled Substance Certificate' },
  { value: 'cme_certificate', label: 'CME Certificate' },
  { value: 'hospital_letter', label: 'Hospital Privileges Letter' },
  { value: 'reference_letter', label: 'Reference Letter' },
  { value: 'other', label: 'Other' },
] as const;

// Expiration notification thresholds (days before expiration)
export const EXPIRATION_THRESHOLDS = [90, 60, 30, 14, 7] as const;

// CAQH status values
export const CAQH_STATUSES = [
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
  { value: 'pending', label: 'Pending' },
  { value: 'expired', label: 'Expired' },
] as const;

// Roster report fields
export * from './rosterFields.js';
