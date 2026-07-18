/**
 * Tasks v2 guided-creation task groups (UX contract D2).
 * The same label map drives the backend title composition AND the frontend
 * live preview, so the preview always equals the persisted title (D1, D3).
 */
export const TASK_GROUP_LABELS = {
  FOLLOW_UP: 'Follow Up',
  CALL_BACK: 'Call Back',
  SUBMIT_APPLICATION: 'Submit Application',
  REQUEST_DOCUMENTS: 'Request Documents',
  CAQH_UPDATE: 'CAQH Update / Re-attestation', // spaced form is canonical (EXPERIENCE.md accepted trade-offs)
  VERIFY_INFORMATION: 'Verify Information',
  ESCALATION: 'Escalation',
  OTHER: 'Other',
  CHECK_IN: 'Check-in', // system-only: rows render the "Auto · Check-in" pill
} as const;

export type TaskGroup = keyof typeof TASK_GROUP_LABELS;

/** The 8 groups a human may pick in the New Task modal — CHECK_IN is system-only (rejected by the create API). */
export const HUMAN_TASK_GROUPS = [
  'FOLLOW_UP',
  'CALL_BACK',
  'SUBMIT_APPLICATION',
  'REQUEST_DOCUMENTS',
  'CAQH_UPDATE',
  'VERIFY_INFORMATION',
  'ESCALATION',
  'OTHER',
] as const satisfies readonly TaskGroup[];

export type HumanTaskGroup = (typeof HUMAN_TASK_GROUPS)[number];

/**
 * Compose a task title from its picked parts (D1, D3):
 * `[Task Group] — [Payer] — [Practice]`, whichever parts are chosen, in that
 * order, em-dash separated. Provider is never part of the title.
 */
export function composeTaskTitle(group: TaskGroup, payerName?: string, practiceName?: string): string {
  return [TASK_GROUP_LABELS[group], payerName, practiceName].filter(Boolean).join(' — ');
}
