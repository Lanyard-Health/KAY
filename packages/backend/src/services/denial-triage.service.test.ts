import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prismaMock } from '../../tests/helpers/mock-prisma.js';

// Mock prisma
vi.mock('../utils/prisma.js', async () => {
  const { prismaMock } = await import('../../tests/helpers/mock-prisma.js');
  return { prisma: prismaMock };
});

// Mock the embedding service
vi.mock('./knowledgeBase.embedding.service.js', () => ({
  searchSimilarWithSources: vi.fn().mockResolvedValue([
    {
      id: 'emb-1',
      contentText: 'Aetna requires DEA registration for all behavioral health providers',
      similarity: 0.92,
      payerTrackId: 'pt-1',
      payerRequirementId: null,
      payerStateRuleId: null,
      payerTimelineId: null,
      payerFormId: null,
      requirementUniversalId: null,
      source: { payerName: 'Aetna', track: 'Behavioral Health' },
    },
  ]),
}));

// Mock Anthropic SDK
const mockCreate = vi.fn().mockResolvedValue({
  content: [{
    type: 'text',
    text: JSON.stringify({
      recommendedAction: 'appeal',
      triageReport: 'The denial appears to be based on a missing DEA registration. However, the provider has a valid DEA number on file.',
      identifiedGaps: [{ gap: 'DEA registration not submitted with application', severity: 'major', source: 'KB Record 1' }],
      recommendedSteps: [
        { order: 1, action: 'Gather DEA certificate', notes: 'Check provider profile' },
        { order: 2, action: 'Submit appeal with DEA documentation' },
      ],
    }),
  }],
  usage: { input_tokens: 500, output_tokens: 300 },
});

vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(function() {
    return { messages: { create: mockCreate } };
  }),
}));

vi.stubEnv('ANTHROPIC_API_KEY', 'test-key');
vi.stubEnv('AI_MODEL', 'claude-sonnet-4-20250514');

import { triggerDenialTriage } from './denial-triage.service.js';

describe('denial-triage.service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates a DenialTriage record with AI analysis', async () => {
    prismaMock.enrollment.findUnique.mockResolvedValueOnce({
      id: 'enr-1',
      provider: { firstName: 'Jane', lastName: 'Smith', npi: '1234567890', entityType: 'individual', targetStates: ['TX'] },
      payer: { name: 'Aetna' },
      payerTrack: { payerName: 'Aetna', track: 'Behavioral Health', stateRegion: 'TX', submissionMethod: 'portal' },
    } as any);

    prismaMock.denialTriage.create.mockResolvedValueOnce({
      id: 'dt-1',
      enrollmentId: 'enr-1',
      denialReason: 'Missing DEA registration',
      status: 'pending',
      recommendedAction: 'appeal',
    } as any);

    const result = await triggerDenialTriage(prismaMock, {
      enrollmentId: 'enr-1',
      denialReason: 'Missing DEA registration',
    });

    expect(result.triageCreated).toBe(true);
    expect(result.triageId).toBe('dt-1');
    expect(prismaMock.denialTriage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          enrollmentId: 'enr-1',
          denialReason: 'Missing DEA registration',
          status: 'pending',
          recommendedAction: 'appeal',
        }),
      })
    );
  });

  it('returns error when enrollment not found', async () => {
    prismaMock.enrollment.findUnique.mockResolvedValueOnce(null);

    const result = await triggerDenialTriage(prismaMock, {
      enrollmentId: 'nonexistent',
      denialReason: 'Some reason',
    });

    expect(result.triageCreated).toBe(false);
    expect(result.error).toBe('Enrollment not found');
  });

  it('falls back to needs_review when AI fails', async () => {
    prismaMock.enrollment.findUnique.mockResolvedValueOnce({
      id: 'enr-2',
      provider: { firstName: 'John', lastName: 'Doe', npi: '9876543210', entityType: null, targetStates: [] },
      payer: { name: 'UHC' },
      payerTrack: null,
    } as any);

    mockCreate.mockRejectedValueOnce(new Error('API rate limit'));

    prismaMock.denialTriage.create.mockResolvedValueOnce({
      id: 'dt-2',
      enrollmentId: 'enr-2',
      status: 'pending',
      recommendedAction: 'needs_review',
    } as any);

    const result = await triggerDenialTriage(prismaMock, {
      enrollmentId: 'enr-2',
      denialReason: 'Application incomplete',
    });

    expect(result.triageCreated).toBe(true);
    expect(prismaMock.denialTriage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          recommendedAction: 'needs_review',
        }),
      })
    );
  });

  it('includes denial date in triage record', async () => {
    const denialDate = new Date('2026-03-15');

    prismaMock.enrollment.findUnique.mockResolvedValueOnce({
      id: 'enr-3',
      provider: { firstName: 'Alice', lastName: 'Wong', npi: '1111111111', entityType: 'individual', targetStates: [] },
      payer: { name: 'Cigna' },
      payerTrack: null,
    } as any);

    prismaMock.denialTriage.create.mockResolvedValueOnce({
      id: 'dt-3',
      enrollmentId: 'enr-3',
      denialDate,
    } as any);

    await triggerDenialTriage(prismaMock, {
      enrollmentId: 'enr-3',
      denialReason: 'Provider not in network area',
      denialDate,
    });

    expect(prismaMock.denialTriage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          denialDate,
        }),
      })
    );
  });
});
