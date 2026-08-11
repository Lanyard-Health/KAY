import { describe, it, expect } from 'vitest';
import { badgeFor, ROLE_BADGE } from './roleBadge';

describe('badgeFor', () => {
  it('labels a practice admin as a practice admin', () => {
    // The bug: practice_admin was absent from the table, so it fell through to
    // the Credentialing Staff badge and every practice admin was mislabelled.
    expect(badgeFor('practice_admin').label).toBe('Practice Admin');
  });

  it('never falls back to another real role', () => {
    const badge = badgeFor('some_future_role');
    const realLabels = Object.values(ROLE_BADGE).map((b) => b.label);
    expect(realLabels).not.toContain(badge.label);
    expect(badge.label).toBe('Some Future Role');
  });

  it('covers every system role the app assigns', () => {
    for (const role of ['admin', 'lanyard_staff', 'credentialing_staff', 'practice_admin', 'provider']) {
      expect(ROLE_BADGE[role], `${role} has no badge and would fall back`).toBeDefined();
    }
  });
});
