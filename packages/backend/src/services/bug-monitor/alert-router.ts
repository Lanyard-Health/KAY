import { emailService } from '../email.service.js';
import type { SanitizedBugReport } from './types.js';

function structuredLog(data: Record<string, unknown>): void {
  console.log(JSON.stringify({ service: 'bugMonitor', ...data }));
}

class AlertRouter {
  async sendUrgentAlert(report: SanitizedBugReport, linearIssueUrl: string | null): Promise<boolean> {
    const alertEmail = process.env['BUG_ALERT_EMAIL'];

    if (!alertEmail) {
      structuredLog({ action: 'alertSkipped', reason: 'BUG_ALERT_EMAIL not set' });
      return false;
    }

    try {
      const linearLink = linearIssueUrl
        ? `<p><strong>Linear Issue:</strong> <a href="${linearIssueUrl}">${linearIssueUrl}</a></p>`
        : '<p><em>Linear issue pending — will be created on next sync</em></p>';

      const htmlBody = `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px;">
          <h2 style="color: #dc2626; margin-bottom: 16px;">Urgent Bug Alert</h2>
          <table style="width: 100%; border-collapse: collapse; margin-bottom: 16px;">
            <tr>
              <td style="padding: 8px 12px; border: 1px solid #e5e7eb; font-weight: 600;">Source</td>
              <td style="padding: 8px 12px; border: 1px solid #e5e7eb;">${report.source}</td>
            </tr>
            <tr>
              <td style="padding: 8px 12px; border: 1px solid #e5e7eb; font-weight: 600;">Error Class</td>
              <td style="padding: 8px 12px; border: 1px solid #e5e7eb;">${report.errorClass || 'unknown'}</td>
            </tr>
            <tr>
              <td style="padding: 8px 12px; border: 1px solid #e5e7eb; font-weight: 600;">Error Message</td>
              <td style="padding: 8px 12px; border: 1px solid #e5e7eb;">${report.errorMessage.substring(0, 500)}</td>
            </tr>
            <tr>
              <td style="padding: 8px 12px; border: 1px solid #e5e7eb; font-weight: 600;">Timestamp</td>
              <td style="padding: 8px 12px; border: 1px solid #e5e7eb;">${report.occurredAt.toISOString()}</td>
            </tr>
          </table>
          ${linearLink}
          <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 16px 0;" />
          <p style="color: #6b7280; font-size: 12px;">Sent by Lanyard Bug Monitor</p>
        </div>
      `;

      const result = await emailService.sendEmail({
        to: alertEmail,
        subject: `[URGENT BUG] ${report.title}`,
        html: htmlBody,
      });

      if (!result.success) {
        structuredLog({ action: 'alertFailed', reason: result.error || 'SES send failed', title: report.title });
        return false;
      }

      return true;
    } catch (error) {
      structuredLog({
        action: 'alertFailed',
        error: error instanceof Error ? error.message : 'Unknown error',
        title: report.title,
      });
      return false;
    }
  }
}

export const alertRouter = new AlertRouter();
