import { describe, it, expect } from 'vitest';
import { APPROVAL_EXPIRY_MS, approvalExpiryFromNow } from './approval-policy.js';

describe('approval-policy', () => {
  it('exports a 7-day TTL in milliseconds', () => {
    expect(APPROVAL_EXPIRY_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it('approvalExpiryFromNow returns a date roughly 7 days from now', () => {
    const before = Date.now();
    const expiry = approvalExpiryFromNow();
    const after = Date.now();
    const lower = before + APPROVAL_EXPIRY_MS - 100;
    const upper = after + APPROVAL_EXPIRY_MS + 100;
    expect(expiry.getTime()).toBeGreaterThanOrEqual(lower);
    expect(expiry.getTime()).toBeLessThanOrEqual(upper);
  });
});
