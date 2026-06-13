import { callLLM } from '../../utils/llm.js';
import type { SanitizedBugReport, BugWriteup, BugSeverity } from './types.js';

// The "auto bug writer". A beta tester submits an informal sentence plus the
// context the widget captured (page, browser, recent client errors). This turns
// that into a structured engineering ticket. Uses Sonnet — quality matters for
// inferring repro steps, and beta volume makes the cost negligible. Falls back
// to a plain ticket built from the raw input on any model/parse failure, so a
// report is NEVER lost just because the LLM was unavailable.
const DEFAULT_MODEL = 'claude-sonnet-4-6';

const VALID_SEVERITIES: BugSeverity[] = ['urgent', 'high', 'medium', 'low'];

const SYSTEM_PROMPT = [
  'You are a bug-report writer for a healthcare provider-credentialing SaaS (Lanyard Health).',
  'A beta tester submitted a short, informal description plus captured context (the page they were on, browser, any recent client-side errors).',
  'Turn it into a clear, structured engineering bug ticket.',
  'Return ONLY valid JSON (no markdown fences) with these fields:',
  '- title: concise summary, under 100 chars',
  '- stepsToReproduce: array of short step strings (infer from the description + page context; if you genuinely cannot tell, use ["Not specified by reporter"])',
  '- expected: what the user expected to happen',
  '- actual: what actually happened',
  '- area: the product area / page involved (e.g. "Provider detail", "Enrollment")',
  '- severity: one of urgent, high, medium, low',
  'Never invent specifics (IDs, names, exact values) you cannot support from the input — write "not specified" instead.',
].join('\n');

// Map the widget's friendly severity words to internal severity.
function severityFromHint(userSeverity: string | undefined): BugSeverity {
  switch ((userSeverity || '').toLowerCase()) {
    case 'blocked':
    case 'high':
      return 'high';
    case 'fyi':
    case 'low':
      return 'low';
    default:
      return 'medium'; // "annoying" / unspecified
  }
}

class BugWriter {
  async write(report: SanitizedBugReport): Promise<BugWriteup> {
    const model = process.env['BUG_WRITER_MODEL'] || DEFAULT_MODEL;
    const m = report.metadata;

    const userMessage = [
      `Reporter description: ${report.errorMessage}`,
      `Reporter severity: ${m['userSeverity'] || 'unspecified'}`,
      `Page/route: ${m['route'] || m['url'] || 'unknown'}`,
      `Browser: ${m['userAgent'] || 'unknown'}`,
      m['recentErrors'] ? `Recent client errors:\n${m['recentErrors']}` : '',
    ].filter(Boolean).join('\n');

    try {
      const response = await callLLM({
        model,
        maxTokens: 1500,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userMessage }],
      });

      const parsed = JSON.parse(response.text);
      if (parsed && typeof parsed.title === 'string') {
        return {
          title: String(parsed.title).slice(0, 180),
          stepsToReproduce: Array.isArray(parsed.stepsToReproduce)
            ? parsed.stepsToReproduce.map((s: unknown) => String(s)).slice(0, 20)
            : [],
          expected: typeof parsed.expected === 'string' ? parsed.expected : '',
          actual: typeof parsed.actual === 'string' ? parsed.actual : '',
          area: typeof parsed.area === 'string' ? parsed.area : (m['route'] || 'unknown'),
          severity: VALID_SEVERITIES.includes(parsed.severity)
            ? parsed.severity
            : severityFromHint(m['userSeverity']),
        };
      }
    } catch {
      // fall through to fallback
    }

    return this.fallback(report);
  }

  // Never drop a report: build a usable ticket straight from the raw input.
  private fallback(report: SanitizedBugReport): BugWriteup {
    const m = report.metadata;
    const firstLine = report.errorMessage.split('\n')[0] || 'Beta bug report';
    return {
      title: firstLine.slice(0, 120),
      stepsToReproduce: ['Not specified by reporter'],
      expected: '',
      actual: report.errorMessage,
      area: m['route'] || m['url'] || 'unknown',
      severity: severityFromHint(m['userSeverity']),
    };
  }
}

export const bugWriter = new BugWriter();
