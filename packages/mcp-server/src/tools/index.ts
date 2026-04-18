import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { UserContext } from '../context.js';

// Read tools
import { registerSearchEnrollments } from './search-enrollments.js';
import { registerGetEnrollmentDetails } from './get-enrollment-details.js';
import { registerSearchProviders } from './search-providers.js';
import { registerGetProviderProfile } from './get-provider-profile.js';
import { registerGetExpiringCredentials } from './get-expiring-credentials.js';
import { registerGetOverdueEnrollments } from './get-overdue-enrollments.js';
import { registerGetPrioritySummary } from './get-priority-summary.js';
import { registerGetProviderChecklist } from './get-provider-checklist.js';
import { registerLookupNpi } from './lookup-npi.js';

// Write tools
import { registerCreateTask } from './create-task.js';
import { registerUpdateEnrollmentStatus } from './update-enrollment-status.js';
import { registerLogFollowUp } from './log-follow-up.js';
export function registerAllTools(server: McpServer, ctx: UserContext) {
  // Read tools
  registerSearchEnrollments(server, ctx);
  registerGetEnrollmentDetails(server, ctx);
  registerSearchProviders(server, ctx);
  registerGetProviderProfile(server, ctx);
  registerGetExpiringCredentials(server, ctx);
  registerGetOverdueEnrollments(server, ctx);
  registerGetPrioritySummary(server, ctx);
  registerGetProviderChecklist(server, ctx);
  registerLookupNpi(server, ctx);

  // Write tools
  registerCreateTask(server, ctx);
  registerUpdateEnrollmentStatus(server, ctx);
  registerLogFollowUp(server, ctx);
}
