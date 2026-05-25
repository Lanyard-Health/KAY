import { describe, it, expect } from 'vitest';
import {
  PROVIDER_TYPE_TO_WORKFLOW,
  DUAL_ELIGIBLE_PROVIDER_TYPES,
  PAYER_NAMES_WITHOUT_BH_WORKFLOW,
  resolveWorkflowType,
} from './workflow-mapping.js';

describe('PROVIDER_TYPE_TO_WORKFLOW', () => {
  it('maps psychiatrist to medical', () => {
    expect(PROVIDER_TYPE_TO_WORKFLOW.psychiatrist).toBe('medical');
  });

  it('maps psychologist, lcsw, lpc, lmft, pmhnp to behavioral_health', () => {
    expect(PROVIDER_TYPE_TO_WORKFLOW.psychologist).toBe('behavioral_health');
    expect(PROVIDER_TYPE_TO_WORKFLOW.lcsw).toBe('behavioral_health');
    expect(PROVIDER_TYPE_TO_WORKFLOW.lpc).toBe('behavioral_health');
    expect(PROVIDER_TYPE_TO_WORKFLOW.lmft).toBe('behavioral_health');
    expect(PROVIDER_TYPE_TO_WORKFLOW.pmhnp).toBe('behavioral_health');
  });

  it('maps other to medical', () => {
    expect(PROVIDER_TYPE_TO_WORKFLOW.other).toBe('medical');
  });
});

describe('DUAL_ELIGIBLE_PROVIDER_TYPES', () => {
  it('contains psychiatrist and pmhnp', () => {
    expect(DUAL_ELIGIBLE_PROVIDER_TYPES).toContain('psychiatrist');
    expect(DUAL_ELIGIBLE_PROVIDER_TYPES).toContain('pmhnp');
  });
});

describe('PAYER_NAMES_WITHOUT_BH_WORKFLOW', () => {
  it('contains United Healthcare (UHC routes BH to Optum)', () => {
    expect(PAYER_NAMES_WITHOUT_BH_WORKFLOW).toContain('United Healthcare');
  });
});

describe('resolveWorkflowType', () => {
  it('returns explicit choice when provided', () => {
    expect(resolveWorkflowType('lcsw', 'Aetna', 'medical')).toBe('medical');
  });

  it('returns behavioral_health for BH provider + BH-eligible payer', () => {
    expect(resolveWorkflowType('lcsw', 'Aetna')).toBe('behavioral_health');
  });

  it('falls back to medical for BH provider when payer has no BH workflow', () => {
    expect(resolveWorkflowType('lcsw', 'United Healthcare')).toBe('medical');
  });

  it('matches payer name case-insensitively', () => {
    expect(resolveWorkflowType('lcsw', 'united healthcare')).toBe('medical');
    expect(resolveWorkflowType('lcsw', 'UNITED HEALTHCARE')).toBe('medical');
  });

  it('matches via substring (UHC sub-tracks still fall back)', () => {
    expect(resolveWorkflowType('lcsw', 'United Healthcare Medicare Advantage')).toBe('medical');
  });

  it('returns medical for medical provider regardless of payer', () => {
    expect(resolveWorkflowType('psychiatrist', 'Aetna')).toBe('medical');
    expect(resolveWorkflowType('other', 'Cigna Healthcare')).toBe('medical');
  });

  it('returns explicit choice even when it contradicts provider type', () => {
    expect(
      resolveWorkflowType('psychiatrist', 'United Healthcare', 'behavioral_health')
    ).toBe('behavioral_health');
  });

  it('returns default workflow type when payerName is null/undefined', () => {
    expect(resolveWorkflowType('lcsw', null)).toBe('behavioral_health');
    expect(resolveWorkflowType('lcsw', undefined)).toBe('behavioral_health');
  });
});
