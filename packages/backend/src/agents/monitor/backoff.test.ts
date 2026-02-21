import { describe, it, expect, vi, afterEach } from 'vitest';
import { calculateMonitorDelay } from './backoff.js';

// ==========================================
// Helpers
// ==========================================

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * DAY_MS);
}

// ==========================================
// Tests
// ==========================================

describe('calculateMonitorDelay', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns 4hr delay and isStalled=false for day 1', () => {
    const result = calculateMonitorDelay(daysAgo(1));

    expect(result.delayMs).toBe(4 * HOUR_MS);
    expect(result.isStalled).toBe(false);
  });

  it('returns 8hr delay and isStalled=false for day 8', () => {
    const result = calculateMonitorDelay(daysAgo(8));

    expect(result.delayMs).toBe(8 * HOUR_MS);
    expect(result.isStalled).toBe(false);
  });

  it('returns 24hr delay and isStalled=false for day 15', () => {
    const result = calculateMonitorDelay(daysAgo(15));

    expect(result.delayMs).toBe(24 * HOUR_MS);
    expect(result.isStalled).toBe(false);
  });

  it('returns 48hr delay and isStalled=true for day 31', () => {
    const result = calculateMonitorDelay(daysAgo(31));

    expect(result.delayMs).toBe(48 * HOUR_MS);
    expect(result.isStalled).toBe(true);
  });

  // Boundary tests — exact edges of each tier
  it('returns 4hr delay at exactly day 7 (boundary)', () => {
    const result = calculateMonitorDelay(daysAgo(7));

    expect(result.delayMs).toBe(4 * HOUR_MS);
    expect(result.isStalled).toBe(false);
  });

  it('returns 8hr delay at exactly day 14 (boundary)', () => {
    const result = calculateMonitorDelay(daysAgo(14));

    expect(result.delayMs).toBe(8 * HOUR_MS);
    expect(result.isStalled).toBe(false);
  });

  it('returns 24hr delay at exactly day 30 (boundary)', () => {
    const result = calculateMonitorDelay(daysAgo(30));

    expect(result.delayMs).toBe(24 * HOUR_MS);
    expect(result.isStalled).toBe(false);
  });
});
