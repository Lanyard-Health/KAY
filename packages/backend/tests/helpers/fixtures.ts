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
