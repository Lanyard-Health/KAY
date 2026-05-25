/**
 * Workflow test fixtures
 *
 * Reusable mock data for workflow-related tests.
 *
 * Post Phase-6 cleanup: the legacy `mockWorkflowData` JSON-template fixture
 * (which mirrored payer-workflows.json structure) was removed along with
 * Path B. The remaining fixtures are step-shaped records used by tests that
 * still exercise `EnrollmentWorkflowStep` rows in the DB.
 */

// ============================================================
// Workflow step records (as returned from Prisma)
// ============================================================

export const mockWorkflowStep = {
  id: 'step-1-id',
  enrollmentId: 'enrollment-1-id',
  templateStepId: 'aetna-med-01',
  stepOrder: 1,
  name: 'Submit Application',
  description: 'Submit the credentialing application',
  actionType: 'form_submission',
  url: null,
  owner: 'provider',
  estimatedDays: 5,
  dependencies: [] as string[],
  documentsNeeded: ['application_form'],
  warnings: ['Ensure NPI is current'],
  status: 'not_started',
  notes: null,
  skippedReason: null,
  startedAt: null,
  completedAt: null,
  completedById: null,
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
};

export const mockWorkflowStepInProgress = {
  ...mockWorkflowStep,
  id: 'step-1-ip',
  status: 'in_progress',
  startedAt: new Date('2024-01-02'),
};

export const mockWorkflowStepCompleted = {
  ...mockWorkflowStep,
  id: 'step-1-done',
  status: 'completed',
  startedAt: new Date('2024-01-02'),
  completedAt: new Date('2024-01-05'),
  completedById: 'admin-user-id',
};

export const mockWorkflowStepBlocked = {
  ...mockWorkflowStep,
  id: 'step-2-blocked',
  templateStepId: 'aetna-med-02',
  stepOrder: 2,
  name: 'Payer Review',
  status: 'blocked',
  dependencies: ['aetna-med-01'],
  estimatedDays: 30,
};

export const mockWorkflowStepSkipped = {
  ...mockWorkflowStep,
  id: 'step-3-skipped',
  templateStepId: 'aetna-med-03',
  stepOrder: 3,
  name: 'Committee Decision',
  status: 'skipped',
  skippedReason: 'Not applicable',
  estimatedDays: 14,
};

// ============================================================
// Enrollment with relations
// ============================================================

export const mockEnrollmentWithPayer = {
  id: 'enrollment-1-id',
  providerId: 'provider-1-id',
  payerId: 'payer-1-id',
  payerTrackId: 'track-1-id',
  workflowTemplateId: null,
  status: 'not_started',
  workflowType: null,
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
    name: 'Aetna',
  },
  provider: {
    id: 'provider-1-id',
    firstName: 'Jane',
    lastName: 'Doe',
    providerType: 'lcsw' as const,
  },
};

export const mockEnrollmentTerminal = {
  ...mockEnrollmentWithPayer,
  id: 'enrollment-terminal-id',
  status: 'approved',
};
