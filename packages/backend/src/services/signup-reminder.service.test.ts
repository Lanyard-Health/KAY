import { describe, it, expect } from 'vitest';
import { selectStage, daysSince, buildInviteReminderEmail, buildLoginReminderEmail } from './signup-reminder.service.js';

describe('selectStage — crossed-threshold cadence', () => {
  const none: Record<string, string> = {};
  it('sends nothing before day 2', () => {
    expect(selectStage(0, none)).toBeNull();
    expect(selectStage(1, none)).toBeNull();
  });
  it('sends each stage once, in order', () => {
    expect(selectStage(2, none)).toBe(2);
    expect(selectStage(5, { '2': 'x' })).toBe(5);
    expect(selectStage(7, { '2': 'x', '5': 'x' })).toBe(7);
  });
  it('does not resend a stage already sent (idle days between stages)', () => {
    expect(selectStage(3, { '2': 'x' })).toBeNull();
    expect(selectStage(6, { '2': 'x', '5': 'x' })).toBeNull();
  });
  it('skips straight to the most urgent stage when discovered late (no backfill)', () => {
    expect(selectStage(5, none)).toBe(5); // missed day 2 → send 5, not 2
    expect(selectStage(9, none)).toBe(7); // missed all → send 7 only
  });
  it('sends nothing once the final stage is sent', () => {
    expect(selectStage(8, { '2': 'x', '5': 'x', '7': 'x' })).toBeNull();
    expect(selectStage(20, { '7': 'x' })).toBeNull();
  });
});

describe('daysSince', () => {
  it('floors whole elapsed days', () => {
    const now = new Date('2026-06-20T12:00:00Z');
    expect(daysSince(new Date('2026-06-18T13:00:00Z'), now)).toBe(1); // ~23h short of 2 days
    expect(daysSince(new Date('2026-06-18T11:00:00Z'), now)).toBe(2);
  });
});

describe('email builders', () => {
  it('invite emails greet generically and carry the accept link + support button', () => {
    const { subject, html } = buildInviteReminderEmail(2, 'Somethings', 'https://portal.lanyardhealth.com/accept-invitation/abc');
    expect(subject).toMatch(/invitation is waiting/i);
    expect(html).toContain('Hi there,');
    expect(html).toContain('Somethings');
    expect(html).toContain('https://portal.lanyardhealth.com/accept-invitation/abc');
    expect(html).toContain('operations+support@lanyardhealth.com');
  });
  it('login emails greet by first name and final stage warns of pause', () => {
    expect(buildLoginReminderEmail(2, 'Drew').html).toContain('Hi Drew,');
    expect(buildLoginReminderEmail(7, 'Drew').subject).toMatch(/paused today/i);
  });
});
