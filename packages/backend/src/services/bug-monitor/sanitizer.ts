import type { BugReport, SanitizedBugReport } from './types.js';

const REDACTION_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  // SSN
  { pattern: /\b\d{3}-?\d{2}-?\d{4}\b/g, replacement: '[SSN_REDACTED]' },
  // Email
  { pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, replacement: '[EMAIL_REDACTED]' },
  // Phone
  { pattern: /\b(\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g, replacement: '[PHONE_REDACTED]' },
  // DOB-like dates
  { pattern: /\b(0[1-9]|1[0-2])\/(0[1-9]|[12]\d|3[01])\/(19|20)\d{2}\b/g, replacement: '[DATE_REDACTED]' },
  // NPI
  { pattern: /\bNPI[:\s]*\d{10}\b/gi, replacement: '[NPI_REDACTED]' },
  // Prisma WHERE clauses
  { pattern: /WHERE[\s\S]*?(?=\)|$)/gi, replacement: 'WHERE [PARAMS_REDACTED]' },
  // JSON bodies with PII keys
  { pattern: /\{[\s\S]*"(ssn|dateOfBirth|dob|npi|email|phone|firstName|lastName)"[\s\S]*\}/gi, replacement: '[REQUEST_BODY_OMITTED]' },
];

function scrubString(input: string): string {
  let result = input;
  for (const { pattern, replacement } of REDACTION_PATTERNS) {
    // Reset lastIndex for global regexes reused across calls
    pattern.lastIndex = 0;
    result = result.replace(pattern, replacement);
  }
  return result;
}

function truncateStackFrame(frame: string): string {
  // Match typical stack frame: "at functionName (filepath:line:col)" or "at filepath:line:col"
  const match = frame.match(/at\s+(?:(.+?)\s+\()?([^:(\s]+):(\d+)(?::\d+)?\)?/);
  if (match) {
    const functionName = match[1] || '<anonymous>';
    const rawFile = match[2] || 'unknown';
    const filename = rawFile.split('/').pop() || rawFile;
    const line = match[3];
    return `at ${functionName} (${filename}:${line})`;
  }
  return frame.trim();
}

function sanitizeStackTrace(stackTrace: string): string {
  const lines = stackTrace.split('\n');
  const sanitizedLines = lines.map((line) => {
    const trimmed = line.trim();
    if (trimmed.startsWith('at ')) {
      return truncateStackFrame(trimmed);
    }
    // First line is usually the error message — scrub it
    return scrubString(trimmed);
  });
  return sanitizedLines.join('\n');
}

class BugSanitizer {
  scrub(report: BugReport): SanitizedBugReport {
    const sanitizedMetadata: Record<string, string> = {};
    for (const [key, value] of Object.entries(report.metadata)) {
      sanitizedMetadata[key] = scrubString(value);
    }

    return {
      ...report,
      errorMessage: scrubString(report.errorMessage),
      stackTrace: report.stackTrace
        ? sanitizeStackTrace(report.stackTrace)
        : undefined,
      metadata: sanitizedMetadata,
      _sanitized: true as const,
    };
  }
}

export const bugSanitizer = new BugSanitizer();
