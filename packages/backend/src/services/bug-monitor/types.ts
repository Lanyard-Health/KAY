export type BugSource = 'backend-runtime' | 'frontend-crash' | 'ci-failure' | 'security';
export type BugSeverity = 'urgent' | 'high' | 'medium' | 'low';

export interface BugReport {
  source: BugSource;
  title: string;
  errorMessage: string;
  errorClass?: string;
  stackTrace?: string;
  metadata: Record<string, string>;
  occurredAt: Date;
  environment: 'production' | 'development';
}

export interface SanitizedBugReport extends BugReport {
  _sanitized: true; // Brand type to enforce sanitization ordering
}

export interface TriageResult {
  severity: BugSeverity;
  rootCause: string;
}

export interface NoiseFilterResult {
  action: 'create' | 'digest';
}
