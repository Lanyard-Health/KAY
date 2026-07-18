import { describe, it, expect } from 'vitest';
import {
  composeTaskTitle, TASK_GROUP_LABELS, HUMAN_TASK_GROUPS,
} from '@credential-management/shared';

describe('TASK_GROUP_LABELS', () => {
  it('carries the eight human labels verbatim, including the spaced CAQH form', () => {
    expect(TASK_GROUP_LABELS.FOLLOW_UP).toBe('Follow Up');
    expect(TASK_GROUP_LABELS.CALL_BACK).toBe('Call Back');
    expect(TASK_GROUP_LABELS.SUBMIT_APPLICATION).toBe('Submit Application');
    expect(TASK_GROUP_LABELS.REQUEST_DOCUMENTS).toBe('Request Documents');
    expect(TASK_GROUP_LABELS.CAQH_UPDATE).toBe('CAQH Update / Re-attestation'); // spaced form is canonical
    expect(TASK_GROUP_LABELS.VERIFY_INFORMATION).toBe('Verify Information');
    expect(TASK_GROUP_LABELS.ESCALATION).toBe('Escalation');
    expect(TASK_GROUP_LABELS.OTHER).toBe('Other');
    expect(TASK_GROUP_LABELS.CHECK_IN).toBe('Check-in');
  });
  it('excludes CHECK_IN from the human-pickable groups', () => {
    expect(HUMAN_TASK_GROUPS).toHaveLength(8);
    expect(HUMAN_TASK_GROUPS).not.toContain('CHECK_IN');
  });
});

describe('composeTaskTitle', () => {
  it('group alone', () => {
    expect(composeTaskTitle('FOLLOW_UP')).toBe('Follow Up');
  });
  it('group + payer (em dash with spaces)', () => {
    expect(composeTaskTitle('FOLLOW_UP', 'Molina Healthcare of Texas'))
      .toBe('Follow Up — Molina Healthcare of Texas');
  });
  it('group + payer + practice, in that order', () => {
    expect(composeTaskTitle('CALL_BACK', 'Aetna Better Health', 'Sunrise Behavioral Health'))
      .toBe('Call Back — Aetna Better Health — Sunrise Behavioral Health');
  });
  it('group + practice (payer omitted, no dangling separator)', () => {
    expect(composeTaskTitle('OTHER', undefined, 'Sunrise Behavioral Health'))
      .toBe('Other — Sunrise Behavioral Health');
  });
  it('empty-string parts are omitted like undefined', () => {
    expect(composeTaskTitle('ESCALATION', '', '')).toBe('Escalation');
  });
});
