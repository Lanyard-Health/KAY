import { describe, it, expect } from 'vitest';
import { dashboardGreeting } from './greeting';

describe('dashboardGreeting', () => {
  it('falls back to the brand welcome when no first name is known', () => {
    expect(dashboardGreeting(undefined, 9)).toBe('Welcome to Lanyard Health');
    expect(dashboardGreeting('', 9)).toBe('Welcome to Lanyard Health');
  });

  it('greets by time of day', () => {
    expect(dashboardGreeting('Kay', 0)).toBe('Good morning, Kay');
    expect(dashboardGreeting('Kay', 11)).toBe('Good morning, Kay');
    expect(dashboardGreeting('Kay', 12)).toBe('Good afternoon, Kay');
    expect(dashboardGreeting('Kay', 17)).toBe('Good afternoon, Kay');
    expect(dashboardGreeting('Kay', 18)).toBe('Good evening, Kay');
    expect(dashboardGreeting('Kay', 23)).toBe('Good evening, Kay');
  });
});
