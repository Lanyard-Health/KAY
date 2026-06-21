import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const { mockRunJob, FakeLibrettoCloudError } = vi.hoisted(() => {
  class FakeLibrettoCloudError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'LibrettoCloudError';
    }
  }
  return { mockRunJob: vi.fn(), FakeLibrettoCloudError };
});
vi.mock('../../services/libretto-cloud.client.js', () => ({
  runJob: mockRunJob,
  LibrettoCloudError: FakeLibrettoCloudError,
}));

import { LibrettoCloudAetnaAdapter } from './libretto-cloud-adapter.js';
import type { AetnaRfpProviderData } from './aetna-rfp-adapter.js';
import type { ResolvedCredential } from '../../services/credential.service.js';
import type { SubmissionAdapterInput } from './submission-adapter.js';

// Fully synthetic packet — no real provider data.
function packet(overrides: Partial<AetnaRfpProviderData> = {}): AetnaRfpProviderData {
  return {
    payer: 'Aetna',
    lineOfBusiness: 'BEHAVIORAL_HEALTH',
    joining: 'INDIVIDUAL_NEW',
    submitter: { lastName: 'Test', firstName: 'Sub', role: 'Coordinator', email: 's@example.com', phone: '000-000-0000' },
    provider: {
      lastName: 'Doe', firstName: 'Jane', npi: '0000000000', taxIdType: 'E', taxIdName: 'Doe LLC',
      taxId: '00-0000000', caqhId: '00000000', dob: '01/01/1990', licenseNumber: 'L0', licenseExp: '01/01/2030',
      degree: 'MFT', primarySpecialty: 'Marriage and Family Therapist',
    },
    location: { state: 'Kansas', zip: '67000', street: '1 Test St', city: 'Wichita', phone: '000-000-0000', fax: '000-000-0001', placeOfService: 'Office based', adaAccessible: true },
    behavioralHealth: { ageGroup: ['Adults (Ages 18-64)'], practiceFocus: ['Anxiety Disorders'] },
    telehealth: false,
    ...overrides,
  };
}

function input(data: unknown): SubmissionAdapterInput {
  return { enrollmentRunId: 'run-1', payerId: 'pay-1', practiceId: 'prac-1', providerId: 'prov-1', providerData: data };
}

const credential = { wipe() {} } as unknown as ResolvedCredential;

describe('LibrettoCloudAetnaAdapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env['LIBRETTO_DRY_RUN'];
    delete process.env['LIBRETTO_AETNA_WORKFLOW'];
  });
  afterEach(() => {
    delete process.env['LIBRETTO_DRY_RUN'];
  });

  it('real submit: succeeds and maps requestId -> externalReference', async () => {
    mockRunJob.mockResolvedValue({ result: { requestId: 'R123', reachedSubmitPage: true, submitted: true } });
    const result = await new LibrettoCloudAetnaAdapter().submit(input(packet()), credential);
    expect(result.success).toBe(true);
    expect(result.externalReference).toBe('R123');
    // confirmSubmit should be true on a real (non-dry) run.
    expect(mockRunJob).toHaveBeenCalledWith('aetnaRfpBehavioralHealth', expect.objectContaining({ confirmSubmit: true }));
  });

  it('real submit that did not submit: fails but keeps the requestId', async () => {
    mockRunJob.mockResolvedValue({ result: { requestId: 'R777', reachedSubmitPage: true, submitted: false } });
    const result = await new LibrettoCloudAetnaAdapter().submit(input(packet()), credential);
    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('LIBRETTO_INCOMPLETE');
    expect(result.externalReference).toBe('R777');
  });

  it('dry run: confirmSubmit forced false, reachedSubmitPage counts as success', async () => {
    process.env['LIBRETTO_DRY_RUN'] = 'true';
    mockRunJob.mockResolvedValue({ result: { requestId: 'R9', reachedSubmitPage: true, submitted: false } });
    const result = await new LibrettoCloudAetnaAdapter().submit(input(packet()), credential);
    expect(result.success).toBe(true);
    expect(result.externalReference).toBe('R9');
    expect(mockRunJob).toHaveBeenCalledWith('aetnaRfpBehavioralHealth', expect.objectContaining({ confirmSubmit: false }));
  });

  it('job failure: returns success=false with LIBRETTO_JOB_FAILED', async () => {
    mockRunJob.mockRejectedValue(new FakeLibrettoCloudError('job ended failed'));
    const result = await new LibrettoCloudAetnaAdapter().submit(input(packet()), credential);
    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('LIBRETTO_JOB_FAILED');
  });

  it('bad input: rejects without calling Libretto', async () => {
    const result = await new LibrettoCloudAetnaAdapter().submit(input({ not: 'a packet' }), credential);
    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('BAD_INPUT');
    expect(mockRunJob).not.toHaveBeenCalled();
  });
});
