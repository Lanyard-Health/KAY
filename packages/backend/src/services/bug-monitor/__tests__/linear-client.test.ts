import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { SanitizedBugReport, TriageResult } from '../types.js';

// We need to re-import the module fresh for each test to pick up env var changes
// Use dynamic import + vi.resetModules

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function makeReport(): SanitizedBugReport {
  return {
    source: 'backend-runtime',
    title: 'Test Error',
    errorMessage: 'Something broke',
    errorClass: 'TypeError',
    stackTrace: 'at test (test.ts:1)',
    metadata: { url: '/api/test' },
    occurredAt: new Date('2026-01-01T00:00:00Z'),
    environment: 'production',
    _sanitized: true,
  };
}

function makeTriage(severity: 'urgent' | 'high' | 'medium' | 'low' = 'high'): TriageResult {
  return { severity, rootCause: 'Test root cause' };
}

function mockFetchResponse(data: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => ({ data }),
    text: async () => JSON.stringify(data),
  };
}

describe('LinearClient', () => {
  let linearClient: typeof import('../linear-client.js')['linearClient'];

  beforeEach(async () => {
    vi.resetModules();
    mockFetch.mockReset();
    process.env['LINEAR_API_KEY'] = 'test-api-key';
    process.env['LINEAR_TEAM_ID'] = 'team-123';

    const mod = await import('../linear-client.js');
    linearClient = mod.linearClient;
  });

  afterEach(() => {
    delete process.env['LINEAR_API_KEY'];
    delete process.env['LINEAR_TEAM_ID'];
  });

  describe('createIssue', () => {
    it('sends correct GraphQL mutation with proper variables', async () => {
      mockFetch.mockResolvedValueOnce(mockFetchResponse({
        issueCreate: { success: true, issue: { id: 'issue-1', url: 'https://linear.app/issue-1', identifier: 'BUG-1' } },
      }));

      const result = await linearClient.createIssue(makeReport(), makeTriage());

      expect(result).toEqual({ id: 'issue-1', url: 'https://linear.app/issue-1' });
      expect(mockFetch).toHaveBeenCalledTimes(1);

      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toBe('https://api.linear.app/graphql');
      const body = JSON.parse(options.body);
      expect(body.query).toContain('issueCreate');
      expect(body.variables.teamId).toBe('team-123');
      expect(body.variables.priority).toBe(2); // high = 2
    });

    it('formats title with source prefix', async () => {
      mockFetch.mockResolvedValueOnce(mockFetchResponse({
        issueCreate: { success: true, issue: { id: 'i-1', url: 'https://linear.app/i-1', identifier: 'B-1' } },
      }));

      await linearClient.createIssue(makeReport(), makeTriage());

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.variables.title).toContain('[backend-runtime]');
      expect(body.variables.title).toContain('Test Error');
    });

    it('adds [URGENT] prefix for urgent severity', async () => {
      mockFetch.mockResolvedValueOnce(mockFetchResponse({
        issueCreate: { success: true, issue: { id: 'i-1', url: 'https://linear.app/i-1', identifier: 'B-1' } },
      }));

      await linearClient.createIssue(makeReport(), makeTriage('urgent'));

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.variables.title).toMatch(/^\[URGENT\]/);
      expect(body.variables.priority).toBe(1); // urgent = 1
    });

    it('retries on 429 then succeeds', async () => {
      mockFetch
        .mockResolvedValueOnce(mockFetchResponse(null, false, 429))
        .mockResolvedValueOnce(mockFetchResponse({
          issueCreate: { success: true, issue: { id: 'i-1', url: 'https://linear.app/i-1', identifier: 'B-1' } },
        }));

      const result = await linearClient.createIssue(makeReport(), makeTriage());
      expect(result).toEqual({ id: 'i-1', url: 'https://linear.app/i-1' });
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('retries on 500 then succeeds', async () => {
      mockFetch
        .mockResolvedValueOnce(mockFetchResponse(null, false, 500))
        .mockResolvedValueOnce(mockFetchResponse({
          issueCreate: { success: true, issue: { id: 'i-1', url: 'https://linear.app/i-1', identifier: 'B-1' } },
        }));

      const result = await linearClient.createIssue(makeReport(), makeTriage());
      expect(result).toEqual({ id: 'i-1', url: 'https://linear.app/i-1' });
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('returns null after 3 failures', async () => {
      mockFetch
        .mockResolvedValueOnce(mockFetchResponse(null, false, 500))
        .mockResolvedValueOnce(mockFetchResponse(null, false, 500))
        .mockResolvedValueOnce(mockFetchResponse(null, false, 500));

      const result = await linearClient.createIssue(makeReport(), makeTriage());
      expect(result).toBeNull();
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });
  });

  describe('addComment', () => {
    it('sends correct mutation', async () => {
      mockFetch.mockResolvedValueOnce(mockFetchResponse({
        commentCreate: { success: true },
      }));

      const result = await linearClient.addComment('issue-1', 'Test comment');
      expect(result).toBe(true);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.query).toContain('commentCreate');
      expect(body.variables.issueId).toBe('issue-1');
      expect(body.variables.body).toBe('Test comment');
    });
  });

  describe('kill switch', () => {
    it('returns null immediately when LINEAR_API_KEY is not set', async () => {
      delete process.env['LINEAR_API_KEY'];
      vi.resetModules();
      const mod = await import('../linear-client.js');

      const result = await mod.linearClient.createIssue(makeReport(), makeTriage());
      expect(result).toBeNull();
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });
});
