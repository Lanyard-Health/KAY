export type BugSource = 'backend-runtime' | 'frontend-crash' | 'ci-failure' | 'security' | 'user-report';
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

// Structured output of the AI "bug writer" for user-submitted (beta) reports:
// turns a tester's informal description + captured context into an actionable
// engineering ticket.
export interface BugWriteup {
  title: string;
  stepsToReproduce: string[];
  expected: string;
  actual: string;
  area: string;
  severity: BugSeverity;
}

export interface NoiseFilterResult {
  action: 'create' | 'digest';
}
