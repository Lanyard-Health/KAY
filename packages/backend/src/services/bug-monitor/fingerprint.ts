import { createHash } from 'crypto';
import type { SanitizedBugReport } from './types.js';

class BugFingerprintService {
  generate(report: SanitizedBugReport): string {
    const normalizedMessage = this.normalizeMessage(report.errorMessage);
    const functionNames = this.extractFunctionNames(report.stackTrace);
    const input = `${report.source}|${report.errorClass || 'unknown'}|${normalizedMessage}|${functionNames}`;
    return createHash('sha256').update(input).digest('hex');
  }

  private normalizeMessage(message: string): string {
    return message
      // Replace UUIDs
      .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<ID>')
      // Replace numbers in URL paths
      .replace(/\/\d+/g, '/<N>')
      // Replace ISO timestamps
      .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[^\s]*/g, '<TIMESTAMP>')
      // Trim whitespace and lowercase
      .trim()
      .toLowerCase();
  }

  private extractFunctionNames(stackTrace?: string): string {
    if (!stackTrace) return '';

    const lines = stackTrace.split('\n');
    const names: string[] = [];

    for (const line of lines) {
      if (names.length >= 3) break;

      const trimmed = line.trim();
      if (!trimmed.startsWith('at ')) continue;

      // Match "at FunctionName (file:line:col)" or "at file:line:col"
      const withParens = trimmed.match(/^at\s+(.+?)\s+\(([^:]+):(\d+)/);
      if (withParens) {
        const funcName = withParens[1] || '<anonymous>';
        if (funcName === '<anonymous>' || funcName === 'Object.<anonymous>') {
          const rawFile = withParens[2] || 'unknown';
          const filename = rawFile.split('/').pop() || rawFile;
          names.push(`${filename}:${withParens[3] || '0'}`);
        } else {
          names.push(funcName);
        }
        continue;
      }

      // Match "at file:line:col" (no function name)
      const withoutParens = trimmed.match(/^at\s+([^:]+):(\d+)/);
      if (withoutParens) {
        const rawFile = withoutParens[1] || 'unknown';
        const filename = rawFile.split('/').pop() || rawFile;
        names.push(`${filename}:${withoutParens[2] || '0'}`);
      }
    }

    return names.join('|');
  }
}

export const bugFingerprintService = new BugFingerprintService();
