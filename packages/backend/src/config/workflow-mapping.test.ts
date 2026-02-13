import { describe, it, expect } from 'vitest';
import {
  PROVIDER_TYPE_TO_WORKFLOW,
  DUAL_ELIGIBLE_PROVIDER_TYPES,
  PAYERS_WITH_BH_WORKFLOW,
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

describe('PAYERS_WITH_BH_WORKFLOW', () => {
  it('contains aetna, cigna, optum, humana', () => {
    expect(PAYERS_WITH_BH_WORKFLOW).toContain('aetna');
    expect(PAYERS_WITH_BH_WORKFLOW).toContain('cigna');
    expect(PAYERS_WITH_BH_WORKFLOW).toContain('optum');
    expect(PAYERS_WITH_BH_WORKFLOW).toContain('humana');
  });
});

describe('resolveWorkflowType', () => {
  it('returns explicit choice when provided', () => {
    expect(resolveWorkflowType('lcsw', 'aetna', 'medical')).toBe('medical');
  });

  it('returns behavioral_health for BH provider + BH-eligible payer', () => {
    expect(resolveWorkflowType('lcsw', 'aetna')).toBe('behavioral_health');
  });

  it('falls back to medical for BH provider + non-BH payer', () => {
    expect(resolveWorkflowType('lcsw', 'bcbs')).toBe('medical');
  });

  it('returns medical for medical provider regardless of payer', () => {
    expect(resolveWorkflowType('psychiatrist', 'aetna')).toBe('medical');
    expect(resolveWorkflowType('other', 'cigna')).toBe('medical');
  });

  it('returns explicit choice even when it contradicts provider type', () => {
    expect(
      resolveWorkflowType('psychiatrist', 'bcbs', 'behavioral_health')
    ).toBe('behavioral_health');
  });
});
