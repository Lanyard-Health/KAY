import Anthropic from '@anthropic-ai/sdk';
import type { SanitizedBugReport, TriageResult, BugSeverity } from './types.js';

const ANTHROPIC_API_KEY = process.env['ANTHROPIC_API_KEY'];
const BUG_TRIAGE_MODEL = process.env['BUG_TRIAGE_MODEL'];

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) {
    if (!ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY is not configured');
    }
    client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
  }
  return client;
}

const SYSTEM_PROMPT = 'You are a bug triage assistant for a healthcare credentialing SaaS application. Given an error report, return a JSON object with two fields: severity (one of: urgent, high, medium, low) and rootCause (1-2 sentence hypothesis of why this error occurred). Consider: security implications get higher severity, database errors get high severity, UI rendering errors get medium severity. Respond ONLY with valid JSON, no markdown.';

const VALID_SEVERITIES: BugSeverity[] = ['urgent', 'high', 'medium', 'low'];

class BugTriager {
  async triage(report: SanitizedBugReport): Promise<TriageResult> {
    // Skip AI triage if model is explicitly set to empty string
    if (BUG_TRIAGE_MODEL === '') {
      return this.ruleBasedFallback(report);
    }

    try {
      const anthropic = getClient();
      const model = BUG_TRIAGE_MODEL || 'claude-haiku-4-5-20251001';

      const userMessage = [
        `Source: ${report.source}`,
        `Error Class: ${report.errorClass || 'unknown'}`,
        `Error Message: ${report.errorMessage}`,
        report.stackTrace ? `Stack Trace (first 500 chars):\n${report.stackTrace.substring(0, 500)}` : '',
      ].filter(Boolean).join('\n\n');

      const response = await anthropic.messages.create({
        model,
        max_tokens: 256,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userMessage }],
      });

      const firstBlock = response.content[0];
      const text = firstBlock && 'text' in firstBlock ? firstBlock.text : '';
      const parsed = JSON.parse(text);

      if (
        parsed &&
        typeof parsed.severity === 'string' &&
        VALID_SEVERITIES.includes(parsed.severity) &&
        typeof parsed.rootCause === 'string'
      ) {
        return { severity: parsed.severity, rootCause: parsed.rootCause };
      }

      // Invalid response shape — fall through
      return this.ruleBasedFallback(report);
    } catch {
      // Any failure (API error, JSON parse, missing key) — fall through
      return this.ruleBasedFallback(report);
    }
  }

  private ruleBasedFallback(report: SanitizedBugReport): TriageResult {
    if (report.source === 'security') {
      return { severity: 'high', rootCause: 'Security scan finding — review required' };
    }

    if (report.errorClass && report.errorClass.toLowerCase().includes('prisma')) {
      return { severity: 'high', rootCause: 'Database error — potential data integrity issue' };
    }

    if (report.source === 'ci-failure') {
      return { severity: 'medium', rootCause: 'CI pipeline failure — check build logs' };
    }

    if (report.source === 'frontend-crash') {
      return { severity: 'medium', rootCause: 'Frontend crash — check component stack' };
    }

    return { severity: 'low', rootCause: 'Auto-triaged — review needed' };
  }
}

export const bugTriager = new BugTriager();
