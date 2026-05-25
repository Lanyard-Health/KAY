import { callLLM } from '../../utils/llm.js';
import type { SanitizedBugReport, TriageResult, BugSeverity } from './types.js';

// BUG_TRIAGE_MODEL is the legacy per-service override (kept for backward compat:
// Render currently has it set explicitly). AI_MODEL_CLASSIFIER is the new
// unified env var for all cheap-tier classification calls. Resolution order:
// BUG_TRIAGE_MODEL → AI_MODEL_CLASSIFIER → Haiku default. Setting
// BUG_TRIAGE_MODEL='' (empty string) still disables AI triage (rule-based only).
const BUG_TRIAGE_MODEL = process.env['BUG_TRIAGE_MODEL'];
const AI_MODEL_CLASSIFIER = process.env['AI_MODEL_CLASSIFIER'];

const SYSTEM_PROMPT = 'You are a bug triage assistant for a healthcare credentialing SaaS application. Given an error report, return a JSON object with two fields: severity (one of: urgent, high, medium, low) and rootCause (1-2 sentence hypothesis of why this error occurred). Consider: security implications get higher severity, database errors get high severity, UI rendering errors get medium severity. Respond ONLY with valid JSON, no markdown.';

const VALID_SEVERITIES: BugSeverity[] = ['urgent', 'high', 'medium', 'low'];

class BugTriager {
  async triage(report: SanitizedBugReport): Promise<TriageResult> {
    // Skip AI triage if model is explicitly set to empty string
    if (BUG_TRIAGE_MODEL === '') {
      return this.ruleBasedFallback(report);
    }

    try {
      const model = BUG_TRIAGE_MODEL || AI_MODEL_CLASSIFIER || 'claude-haiku-4-5-20251001';

      const userMessage = [
        `Source: ${report.source}`,
        `Error Class: ${report.errorClass || 'unknown'}`,
        `Error Message: ${report.errorMessage}`,
        report.stackTrace ? `Stack Trace (first 500 chars):\n${report.stackTrace.substring(0, 500)}` : '',
      ].filter(Boolean).join('\n\n');

      const response = await callLLM({
        model,
        maxTokens: 256,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userMessage }],
      });

      const parsed = JSON.parse(response.text);

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
