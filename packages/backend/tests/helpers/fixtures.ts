/** Reusable test data */

export const adminUser = {
  id: 'admin-user-id',
  cognitoId: 'admin-cognito-id',
  email: 'admin@test.com',
  firstName: 'Admin',
  lastName: 'User',
  role: 'admin' as const,
  isActive: true,
  providerId: undefined,
};

export const staffUser = {
  id: 'staff-user-id',
  cognitoId: 'staff-cognito-id',
  email: 'staff@test.com',
  firstName: 'Staff',
  lastName: 'User',
  role: 'credentialing_staff' as const,
  isActive: true,
  providerId: undefined,
};

export const practiceAdminUser = {
  id: 'practice-admin-user-id',
  cognitoId: 'practice-admin-cognito-id',
  email: 'practiceadmin@test.com',
  firstName: 'Practice',
  lastName: 'Admin',
  role: 'practice_admin' as const,
  isActive: true,
  providerId: undefined,
};

export const providerUser = {
  id: 'provider-user-id',
  cognitoId: 'provider-cognito-id',
  email: 'provider@test.com',
  firstName: 'Provider',
  lastName: 'User',
  role: 'provider' as const,
  isActive: true,
  providerId: 'provider-record-id',
};

export const validProviderInput = {
  npi: '1234567890',
  firstName: 'Jane',
  lastName: 'Doe',
  dateOfBirth: '1985-06-15',
  gender: 'female' as const,
  email: 'jane.doe@example.com',
  phone: '(555) 123-4567',
  providerType: 'psychiatrist' as const,
};

export const validEnrollmentInput = {
  payerName: 'Blue Cross Blue Shield',
  status: 'not_started' as const,
  productTypes: ['commercial'],
  applicationDate: '2024-01-15',
};

export const mockProvider = {
  id: 'provider-1-id',
  npi: '1234567890',
  firstName: 'Jane',
  lastName: 'Doe',
  middleName: null,
  suffix: null,
  dateOfBirth: new Date('1985-06-15'),
  gender: 'female',
  email: 'jane.doe@example.com',
  phone: '(555) 123-4567',
  mobilePhone: null,
  fax: null,
  providerType: 'psychiatrist',
  taxonomy: null,
  specialties: [],
  languages: [],
  status: 'active',
  caqhProviderId: null,
  caqhUsername: null,
  caqhPassword: null,
  caqhCredentialsValid: null,
  caqhCredentialsLastChecked: null,
  createdById: 'admin-user-id',
  updatedById: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

export const mockPayer = {
  id: 'payer-1-id',
  name: 'Blue Cross Blue Shield',
  payerId: 'bcbs-001',
  payerType: 'insurance',
  addressLine1: null,
  city: null,
  state: null,
  zipCode: null,
  phone: null,
  website: null,
  notes: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

export const mockEnrollment = {
  id: 'enrollment-1-id',
  providerId: 'provider-1-id',
  payerId: 'payer-1-id',
  status: 'not_started',
  productTypes: ['commercial'],
  applicationDate: null,
  effectiveDate: null,
  terminationDate: null,
  dateContractReceived: null,
  dateContractSigned: null,
  lastFollowUpDate: null,
  recredentialingDate: null,
  providerNumber: null,
  groupNumber: null,
  notes: null,
  createdById: 'admin-user-id',
  updatedById: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  payer: {
    id: 'payer-1-id',
    name: 'Blue Cross Blue Shield',
    payerId: 'bcbs-001',
    payerType: 'insurance',
  },
};

// ==========================================
// User fixtures
// ==========================================

export const mockUser = {
  id: 'user-1-id',
  cognitoId: 'cognito-user-1',
  email: 'user1@test.com',
  firstName: 'Test',
  lastName: 'User',
  role: 'credentialing_staff',
  isActive: true,
  lastLoginAt: null,
  providerId: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

export const validUserInput = {
  email: 'newuser@test.com',
  firstName: 'New',
  lastName: 'User',
  role: 'credentialing_staff' as const,
};

// ==========================================
// Credential fixtures — Licenses
// ==========================================

export const validLicenseInput = {
  licenseType: 'state_medical' as const,
  licenseNumber: 'MD-12345',
  state: 'CA',
  issueDate: '2020-01-15',
  expirationDate: '2025-01-15',
};

export const mockLicense = {
  id: 'license-1-id',
  providerId: 'provider-1-id',
  licenseType: 'state_medical',
  licenseNumber: 'MD-12345',
  state: 'CA',
  issueDate: new Date('2020-01-15'),
  expirationDate: new Date('2025-01-15'),
  status: null,
  notes: null,
  createdById: 'admin-user-id',
  updatedById: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

// ==========================================
// Credential fixtures — Board Certifications
// ==========================================

export const validBoardCertInput = {
  boardType: 'abpn_psychiatry' as const,
  boardName: 'American Board of Psychiatry and Neurology',
  specialty: 'Psychiatry',
  initialCertificationDate: '2018-06-01',
};

export const mockBoardCert = {
  id: 'cert-1-id',
  providerId: 'provider-1-id',
  boardType: 'abpn_psychiatry',
  boardName: 'American Board of Psychiatry and Neurology',
  certificationNumber: null,
  specialty: 'Psychiatry',
  initialCertificationDate: new Date('2018-06-01'),
  expirationDate: null,
  isBoardEligible: false,
  status: null,
  notes: null,
  createdById: 'admin-user-id',
  updatedById: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

// ==========================================
// Credential fixtures — Malpractice Insurance
// ==========================================

export const validMalpracticeInput = {
  carrierName: 'PIAA Insurance',
  policyNumber: 'POL-98765',
  coverageType: 'occurrence' as const,
  perClaimAmount: 1000000,
  aggregateAmount: 3000000,
  effectiveDate: '2024-01-01',
  expirationDate: '2025-01-01',
};

export const mockMalpractice = {
  id: 'malpractice-1-id',
  providerId: 'provider-1-id',
  carrierName: 'PIAA Insurance',
  policyNumber: 'POL-98765',
  coverageType: 'occurrence',
  perClaimAmount: 1000000,
  aggregateAmount: 3000000,
  effectiveDate: new Date('2024-01-01'),
  expirationDate: new Date('2025-01-01'),
  hasTailCoverage: false,
  notes: null,
  createdById: 'admin-user-id',
  updatedById: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

// ==========================================
// Credential fixtures — Education
// ==========================================

export const validEducationInput = {
  institutionName: 'Johns Hopkins University',
  degree: 'md' as const,
  fieldOfStudy: 'Medicine',
  country: 'US',
  startDate: '2010-08-01',
  graduationDate: '2014-05-15',
};

export const mockEducation = {
  id: 'education-1-id',
  providerId: 'provider-1-id',
  institutionName: 'Johns Hopkins University',
  degree: 'md',
  fieldOfStudy: 'Medicine',
  city: null,
  state: null,
  country: 'US',
  startDate: new Date('2010-08-01'),
  endDate: null,
  graduationDate: new Date('2014-05-15'),
  isCompleted: true,
  notes: null,
  createdById: 'admin-user-id',
  updatedById: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

// ==========================================
// Credential fixtures — Work History
// ==========================================

export const validWorkHistoryInput = {
  organizationName: 'City Hospital',
  organizationType: 'hospital',
  position: 'Attending Psychiatrist',
  startDate: '2016-07-01',
  isCurrent: true,
};

export const mockWorkHistory = {
  id: 'work-history-1-id',
  providerId: 'provider-1-id',
  organizationName: 'City Hospital',
  organizationType: 'hospital',
  position: 'Attending Psychiatrist',
  department: null,
  addressLine1: null,
  city: null,
  state: null,
  zipCode: null,
  phone: null,
  startDate: new Date('2016-07-01'),
  endDate: null,
  isCurrent: true,
  reasonForLeaving: null,
  supervisorName: null,
  supervisorPhone: null,
  notes: null,
  createdById: 'admin-user-id',
  updatedById: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

// ==========================================
// Payer fixtures (additional)
// ==========================================

export const validPayerInput = {
  name: 'Aetna',
  payerId: 'aetna-001',
  payerType: 'insurance',
};

export const validPayerEnrollmentInput = {
  payerId: '00000000-0000-0000-0000-000000000001',
  status: 'not_started' as const,
};
