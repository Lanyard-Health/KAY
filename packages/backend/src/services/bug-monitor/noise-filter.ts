import type { BugReport, BugSeverity, SanitizedBugReport, NoiseFilterResult } from './types.js';

const SEVERITY_ORDER: BugSeverity[] = ['low', 'medium', 'high', 'urgent'];

// Patterns that identify dev-environment Vite artifacts, never real
// production bugs. Suppressed before fingerprinting so they never reach
// Linear. Triggered 12 Linear duplicates (OPS-24/25/27-30/35-40) in May 2026
// before this filter existed; see PR that introduced this for context.
const VITE_CHUNK_PATH = /\/node_modules\/\.vite\/deps\//;
const DYNAMIC_IMPORT_FAILURE = /Failed to fetch dynamically imported module/i;

class NoiseFilter {
  /**
   * Returns a suppression decision for a report BEFORE it enters the
   * sanitize → fingerprint → Linear pipeline. Use to drop known-noise
   * patterns (e.g. stale Vite dev-cache crashes) that would otherwise
   * file false-positive Linear issues.
   *
   * Conservative by design: only suppresses dev-environment frontend
   * crashes whose stack/message matches a known Vite-cache fingerprint.
   * A production report with the same shape still files a Linear issue,
   * because in production those patterns indicate a real CDN cache
   * mismatch worth investigating.
   */
  shouldSuppress(bug: BugReport): { suppress: true; reason: string } | { suppress: false } {
    if (bug.source !== 'frontend-crash' || bug.environment !== 'development') {
      return { suppress: false };
    }

    const filename = bug.metadata['filename'] || '';
    if (VITE_CHUNK_PATH.test(filename)) {
      return { suppress: true, reason: 'dev-vite-chunk-crash' };
    }

    if (DYNAMIC_IMPORT_FAILURE.test(bug.errorMessage)) {
      return { suppress: true, reason: 'dev-dynamic-import-failure' };
    }

    return { suppress: false };
  }

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
