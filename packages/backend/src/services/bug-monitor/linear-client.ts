import type { SanitizedBugReport, TriageResult, BugSeverity } from './types.js';

const PRIORITY_MAP: Record<BugSeverity, number> = { urgent: 1, high: 2, medium: 3, low: 4 };
const MAX_RETRIES = 3;
const LINEAR_API_URL = 'https://api.linear.app/graphql';

function structuredLog(data: Record<string, unknown>): void {
  console.log(JSON.stringify({ service: 'bugMonitor', ...data }));
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class LinearClient {
  private getApiKey(): string | null {
    const key = process.env['LINEAR_API_KEY'];
    if (!key) {
      structuredLog({ action: 'linearSkipped', reason: 'LINEAR_API_KEY not set' });
      return null;
    }
    return key;
  }

  private async executeWithRetry<T>(
    operation: (apiKey: string) => Promise<T>,
    context: { action: string; issueId?: string },
  ): Promise<T | null> {
    const apiKey = this.getApiKey();
    if (!apiKey) return null;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        return await operation(apiKey);
      } catch (error) {
        const status = error instanceof Error && 'status' in error ? (error as any).status : undefined;
        const isRetryable = status === 429 || (status && status >= 500);

        structuredLog({
          action: 'linearRetry',
          attempt,
          status: status || 'unknown',
          issueId: context.issueId,
          error: error instanceof Error ? error.message : 'Unknown error',
        });

        if (!isRetryable || attempt === MAX_RETRIES) {
          return null;
        }

        // Exponential backoff: 1s, 2s, 4s
        await sleep(Math.pow(2, attempt - 1) * 1000);
      }
    }

    return null;
  }

  private async graphql(apiKey: string, query: string, variables: Record<string, unknown>): Promise<any> {
    const response = await fetch(LINEAR_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query, variables }),
    });

    if (!response.ok) {
      const err = new Error(`Linear API error: ${response.status}`);
      (err as any).status = response.status;
      throw err;
    }

    const json = await response.json();
    if (json.errors?.length) {
      throw new Error(`Linear GraphQL error: ${json.errors[0].message}`);
    }

    return json.data;
  }

  async createIssue(report: SanitizedBugReport, triage: TriageResult): Promise<{ id: string; url: string } | null> {
    const teamId = process.env['LINEAR_TEAM_ID'];
    if (!teamId) {
      structuredLog({ action: 'linearSkipped', reason: 'LINEAR_TEAM_ID not set' });
      return null;
    }

    return this.executeWithRetry(
      async (apiKey) => {
        let title = `[${report.source}] ${report.title}`;
        if (triage.severity === 'urgent') {
          title = `[URGENT] ${title}`;
        }
        title = title.substring(0, 200);

        const description = [
          '**Auto-detected Bug**',
          `**Source:** ${report.source} | **Severity:** ${triage.severity} | **Environment:** ${report.environment}`,
          `**First seen:** ${report.occurredAt.toISOString()}`,
          '',
          '## Error',
          `\`${report.errorClass || 'Error'}\`: ${report.errorMessage}`,
          '',
          report.stackTrace ? `## Stack Trace\n\`\`\`\n${report.stackTrace.substring(0, 1000)}\n\`\`\`` : '',
          '',
          '## AI Triage',
          triage.rootCause,
          '',
          '## Context',
          ...Object.entries(report.metadata).map(([k, v]) => `- **${k}**: ${v}`),
          '',
          '---',
          '*Created by Lanyard Bug Monitor • Occurrences: 1*',
        ].filter((line) => line !== undefined).join('\n');

        const query = `
          mutation CreateIssue($title: String!, $description: String!, $teamId: String!, $priority: Int, $labelIds: [String!]) {
            issueCreate(input: { title: $title, description: $description, teamId: $teamId, priority: $priority, labelIds: $labelIds }) {
              success
              issue { id url identifier }
            }
          }
        `;

        const labelIds = process.env['LINEAR_BUG_LABEL_ID'] ? [process.env['LINEAR_BUG_LABEL_ID']] : [];

        const data = await this.graphql(apiKey, query, {
          title,
          description,
          teamId,
          priority: PRIORITY_MAP[triage.severity],
          labelIds: labelIds.length > 0 ? labelIds : undefined,
        });

        if (data.issueCreate?.success && data.issueCreate.issue) {
          return { id: data.issueCreate.issue.id, url: data.issueCreate.issue.url };
        }

        throw new Error('Linear issueCreate returned success: false');
      },
      { action: 'createIssue' },
    );
  }

  async updateIssue(issueId: string, updates: { priority?: number; title?: string }): Promise<boolean> {
    const result = await this.executeWithRetry(
      async (apiKey) => {
        const query = `
          mutation UpdateIssue($issueId: String!, $input: IssueUpdateInput!) {
            issueUpdate(id: $issueId, input: $input) {
              success
            }
          }
        `;

        const input: Record<string, unknown> = {};
        if (updates.priority !== undefined) input['priority'] = updates.priority;
        if (updates.title !== undefined) input['title'] = updates.title;

        const data = await this.graphql(apiKey, query, { issueId, input });
        return data.issueUpdate?.success === true;
      },
      { action: 'updateIssue', issueId },
    );

    return result === true;
  }

  async addComment(issueId: string, body: string): Promise<boolean> {
    const result = await this.executeWithRetry(
      async (apiKey) => {
        const query = `
          mutation AddComment($issueId: String!, $body: String!) {
            commentCreate(input: { issueId: $issueId, body: $body }) {
              success
            }
          }
        `;

        const data = await this.graphql(apiKey, query, { issueId, body });
        return data.commentCreate?.success === true;
      },
      { action: 'addComment', issueId },
    );

    return result === true;
  }
}

export const linearClient = new LinearClient();
