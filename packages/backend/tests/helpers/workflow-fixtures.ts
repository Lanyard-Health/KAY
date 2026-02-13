/**
 * Workflow test fixtures
 *
 * Reusable mock data for workflow-related tests.
 */

// ============================================================
// Workflow template data (mirrors payer-workflows.json structure)
// ============================================================

export const mockWorkflowData = {
  schema_version: '1.0',
  payers: {
    aetna: {
      id: 'aetna',
      name: 'Aetna',
      parent_company: 'CVS Health',
      workflows: {
        medical: {
          label: 'Medical Credentialing',
          estimated_timeline: {
            official_days: { min: 30, max: 60, unit: 'days' },
            real_world_days: { min: 45, max: 90, unit: 'days' },
          },
          steps: [
            {
              id: 'aetna-med-01',
              name: 'Submit Application',
              description: 'Submit the credentialing application',
              action_type: 'form_submission',
              owner: 'provider',
              estimated_days: 5,
              dependencies: [],
              documents_needed: ['application_form'],
              warnings: ['Ensure NPI is current'],
            },
            {
              id: 'aetna-med-02',
              name: 'Payer Review',
              description: 'Payer reviews application',
              action_type: 'payer_review',
              owner: 'payer',
              estimated_days: { min: 15, max: 30 },
              dependencies: ['aetna-med-01'],
              documents_needed: [],
              warnings: [],
            },
            {
              id: 'aetna-med-03',
              name: 'Committee Decision',
              description: 'Credentialing committee decision',
              action_type: 'committee_review',
              url: 'https://aetna.com/portal',
              owner: 'payer',
              estimated_days: 14,
              dependencies: ['aetna-med-02', 'caqh-007'],
              documents_needed: [],
              warnings: ['May require additional docs'],
            },
          ],
        },
        behavioral_health: {
          label: 'Behavioral Health Credentialing',
          estimated_timeline: {
            official_days: { min: 20, max: 45, unit: 'days' },
            real_world_days: { min: 30, max: 60, unit: 'days' },
          },
          steps: [
            {
              id: 'aetna-bh-01',
              name: 'BH Application',
              description: 'Submit BH credentialing application',
              action_type: 'form_submission',
              owner: 'staff',
              estimated_days: 3,
              dependencies: [],
              documents_needed: [],
              warnings: [],
            },
            {
              id: 'aetna-bh-02',
              name: 'BH Review',
              description: 'BH payer review',
              action_type: 'unknown_action',
              owner: 'unknown_owner',
              estimated_days: 20,
              dependencies: ['aetna-bh-01'],
              documents_needed: [],
              warnings: [],
            },
          ],
        },
      },
    },
    bcbs: {
      id: 'bcbs',
      name: 'Blue Cross Blue Shield',
      parent_company: 'BCBS Association',
      workflows: {
        medical: {
          label: 'BCBS Medical Credentialing',
          estimated_timeline: {
            official_days: { min: 30, max: 60, unit: 'days' },
            real_world_days: { min: 45, max: 90, unit: 'days' },
          },
          steps: [
            {
              id: 'bcbs-med-01',
              name: 'BCBS Application',
              description: 'Submit BCBS application',
              action_type: 'portal_registration',
              owner: 'admin',
              estimated_days: 7,
              dependencies: [],
              documents_needed: [],
              warnings: [],
            },
          ],
        },
      },
    },
  },
  action_types: {
    form_submission: { label: 'Form Submission', icon: 'document', color: 'blue' },
    payer_review: { label: 'Payer Review', icon: 'eye', color: 'yellow' },
    committee_review: { label: 'Committee Review', icon: 'users', color: 'purple' },
    portal_registration: { label: 'Portal Registration', icon: 'globe', color: 'green' },
  },
  status_model: {},
};

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
    workflowKey: 'aetna',
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
