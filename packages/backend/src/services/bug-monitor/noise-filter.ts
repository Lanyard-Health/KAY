import type { BugSeverity, SanitizedBugReport, NoiseFilterResult } from './types.js';

const SEVERITY_ORDER: BugSeverity[] = ['low', 'medium', 'high', 'urgent'];

class NoiseFilter {
  check(_report: SanitizedBugReport, existingCount: number): NoiseFilterResult {
    // First occurrence of a new error always gets a Linear issue
    if (existingCount === 0) {
      return { action: 'create' };
    }

    const threshold = parseInt(process.env['BUG_MONITOR_NOISE_THRESHOLD'] || '10', 10);

    // If below threshold in the last hour, digest instead of creating
    if (existingCount < threshold) {
      return { action: 'digest' };
    }

    return { action: 'create' };
  }

  checkEscalation(currentSeverity: BugSeverity, hourlyRate: number, dailyAvgRate: number): BugSeverity {
    // Spike: 5x daily average → urgent
    if (hourlyRate >= 5 * dailyAvgRate) {
      return 'urgent';
    }

    // Elevated: 2x daily average → escalate one level
    if (hourlyRate >= 2 * dailyAvgRate) {
      const currentIndex = SEVERITY_ORDER.indexOf(currentSeverity);
      const escalatedIndex = Math.min(currentIndex + 1, SEVERITY_ORDER.length - 1);
      return SEVERITY_ORDER[escalatedIndex] as BugSeverity;
    }

    return currentSeverity;
  }
}

export const noiseFilter = new NoiseFilter();
