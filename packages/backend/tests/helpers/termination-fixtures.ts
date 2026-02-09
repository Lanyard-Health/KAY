/** Reusable test data for termination workflow tests */

// Use valid UUIDs for fields that pass through Zod .uuid() validation
const PROVIDER_UUID = '00000000-0000-4000-a000-000000000001';
const ENROLLMENT_BCBS_UUID = '00000000-0000-4000-a000-000000000010';
const ENROLLMENT_AETNA_UUID = '00000000-0000-4000-a000-000000000011';
const TASK_UUID = '00000000-0000-4000-a000-000000000020';
const DRAFT_LETTER_TASK_UUID = '00000000-0000-4000-a000-000000000021';
const LETTER_UUID = '00000000-0000-4000-a000-000000000030';
const LOCATION_UUID = '00000000-0000-4000-a000-000000000040';

export const mockProviderForTermination = {
  id: PROVIDER_UUID,
  firstName: 'Sheree',
  lastName: 'Mitchell',
  middleName: 'Ann',
  suffix: 'MD',
  npi: '9876543210',
};

export const mockPrimaryLocation = {
  id: LOCATION_UUID,
  providerId: PROVIDER_UUID,
  isPrimary: true,
  isActive: true,
  taxId: '12-3456789',
  groupNpi: '1112223334',
  createdAt: new Date('2024-01-15T12:00:00Z'),
};

export const mockPayer1 = {
  id: '00000000-0000-4000-a000-000000000050',
  name: 'Blue Cross Blue Shield',
};

export const mockPayer2 = {
  id: '00000000-0000-4000-a000-000000000051',
  name: 'Aetna',
};

// Use noon UTC to avoid timezone-shifting to a different date
export const mockEnrollment1 = {
  id: ENROLLMENT_BCBS_UUID,
  providerId: PROVIDER_UUID,
  payerId: mockPayer1.id,
  effectiveDate: new Date('2023-01-15T12:00:00Z'),
  terminationDate: new Date('2026-03-15T12:00:00Z'),
  payerEmail: 'providerrelations@bcbs.com',
  payer: { name: 'Blue Cross Blue Shield' },
};

export const mockEnrollment2 = {
  id: ENROLLMENT_AETNA_UUID,
  providerId: PROVIDER_UUID,
  payerId: mockPayer2.id,
  effectiveDate: new Date('2023-06-15T12:00:00Z'),
  terminationDate: null,
  payerEmail: null,
  payer: { name: 'Aetna' },
};

export const mockTask = {
  id: TASK_UUID,
  providerId: PROVIDER_UUID,
  enrollmentId: ENROLLMENT_BCBS_UUID,
  title: 'Terminate enrollment with Blue Cross Blue Shield',
  description: 'Submit termination request to Blue Cross Blue Shield for this provider\'s enrollment.',
  type: 'TERMINATE_ENROLLMENT' as const,
  status: 'PENDING' as const,
  assignedToId: null,
  dueDate: null,
  completedAt: null,
  completedById: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

export const mockDraftLetterTask = {
  id: DRAFT_LETTER_TASK_UUID,
  providerId: PROVIDER_UUID,
  enrollmentId: ENROLLMENT_BCBS_UUID,
  title: 'Draft termination letter for Blue Cross Blue Shield',
  description: 'Prepare and send a formal termination letter to Blue Cross Blue Shield.',
  type: 'DRAFT_TERM_LETTER' as const,
  status: 'PENDING' as const,
  assignedToId: null,
  dueDate: null,
  completedAt: null,
  completedById: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

export const mockTerminationLetter = {
  id: LETTER_UUID,
  providerId: PROVIDER_UUID,
  taskId: DRAFT_LETTER_TASK_UUID,
  payerName: 'Blue Cross Blue Shield',
  payerEmail: 'providerrelations@bcbs.com',
  providerName: 'Sheree Ann Mitchell MD',
  npi: '9876543210',
  groupNpi: '1112223334',
  taxId: 'XX-XXX6789',
  letterContent: 'Generated letter content...',
  status: 'DRAFT' as const,
  reviewedById: null,
  reviewedAt: null,
  sentAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};
