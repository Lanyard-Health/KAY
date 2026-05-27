import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Tier 1 #2: Multi-tenancy CI guardrail.
 *
 * Scans every route file under packages/backend/src/routes/ for direct
 * Prisma calls on tenant-scoped models. For each file that touches one,
 * asserts the file references at least one practice-scope marker
 * (helper function, self-access pattern, or req.practiceScope). Routes
 * that legitimately operate cross-practice (external webhooks, system
 * jobs) live on an explicit allowlist with a one-line justification.
 *
 * This test catches the "added a route but forgot to scope it" failure
 * mode — the same class of bug as the denial-triage finding that
 * prompted this guardrail (see PR #294 commit history).
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROUTES_DIR = join(__dirname, '..', 'src', 'routes');

// Prisma model accessors whose underlying tables carry tenant-scoping
// (direct practiceId column OR reachable via a relation that does).
// Listed in camelCase matching Prisma client property names.
const TENANT_SCOPED_MODELS = [
  // Provider + identity
  'providerProfile',
  'providerApplication',
  'providerImport',
  'providerDisclosure',
  'providerCertification',
  'providerIdentifier',
  'providerBanking',
  'providerDemographics',
  'providerCaqhMirror',
  // Practice
  'practiceLocation',
  // Credentials
  'license',
  'boardCertification',
  'malpracticeInsurance',
  'malpracticeClaim',
  'education',
  'workHistory',
  'workHistoryGap',
  'hospitalAffiliation',
  'professionalReference',
  'disciplinaryAction',
  'continuingEducation',
  'supervisingPhysician',
  'deaRegistration',
  'cdsRegistration',
  // Enrollments
  'enrollment',
  'enrollmentWorkflow',
  'enrollmentWorkflowStep',
  'payerEnrollmentData',
  // Documents
  'document',
  'providerChecklist',
  // Approvals
  'pendingApproval',
  'followUpRun',
  // AI
  'chatConversation',
  'chatMessage',
  'aiRecommendation',
  'denialTriage',
  'agentWorkflow',
  'agentTask',
  'agentEvent',
  'agentAction',
  // Notifications + tasks
  'task',
  'terminationLetter',
  'adminNotification',
  'inAppNotification',
  // Billing
  'subscription',
  'invoice',
  // Vendor logs
  'caqhSyncLog',
  'retellCallLog',
  'aetnaEnrollmentRun',
];

// Operations that read or write rows — anything that needs scoping.
// `aggregate` and `groupBy` are also row-scoped operations.
const MUTATING_OR_READING_OPS = [
  'findMany',
  'findFirst',
  'findUnique',
  'findUniqueOrThrow',
  'findFirstOrThrow',
  'update',
  'delete',
  'count',
  'upsert',
  'create',
  'deleteMany',
  'updateMany',
  'createMany',
  'aggregate',
  'groupBy',
];

// Markers that indicate the route is practice-scope-aware. Any one of
// these in the file body counts as proof the author thought about scope.
// Add to this list when introducing a new helper.
const SCOPE_MARKERS = [
  'getPracticeProviderFilter',
  'getPracticeRelationFilter',
  'validateProviderPracticeAccess',
  'requirePracticeProvider',
  'assertDocumentAccess',
  'denialScopeFilter',     // local helper inside denial-triage.routes.ts
  'req.practiceScope',
  // Portal pattern: provider sees only their own data via req.user!.providerId.
  // This is a stricter form of scoping — self-access only — and is the
  // canonical pattern for /portal routes.
  'req.user!.providerId',
  'req.user?.providerId',
  'req.user.providerId',
];

// Routes that legitimately operate cross-practice. Each entry must have
// a justification. If you add to this list, the justification must
// explain WHY scope can be omitted (external auth, system job, etc.).
const ALLOWLIST: Record<string, string> = {
  'webhook.routes.ts':
    'External webhook authenticated by HMAC signature, not by user session. ' +
    'No req.user/practiceScope is available; lookup is by enrollmentId or ' +
    'NPI+payer pair. Cross-practice writes are intentional and expected.',
};

interface Finding {
  file: string;
  models: string[];
}

function scanRouteFile(absPath: string, fileName: string): Finding | null {
  const src = readFileSync(absPath, 'utf8');

  // Quick exit: if the file references any scope marker, it's covered.
  for (const marker of SCOPE_MARKERS) {
    if (src.includes(marker)) return null;
  }

  // Otherwise, find which tenant-scoped Prisma calls it makes.
  const found: string[] = [];
  for (const model of TENANT_SCOPED_MODELS) {
    for (const op of MUTATING_OR_READING_OPS) {
      const needle = `prisma.${model}.${op}`;
      if (src.includes(needle)) {
        found.push(`${model}.${op}`);
        break; // one match per model is enough to flag
      }
    }
  }

  if (found.length === 0) return null;
  return { file: fileName, models: found };
}

describe('Tenant-scope coverage across route files', () => {
  it('every route file that touches a tenant-scoped Prisma model uses a scope marker (or is allowlisted)', () => {
    const entries = readdirSync(ROUTES_DIR, { withFileTypes: true });
    const routeFiles = entries
      .filter((e) => e.isFile() && e.name.endsWith('.ts') && !e.name.endsWith('.test.ts'))
      .map((e) => e.name);

    const findings: Finding[] = [];
    for (const fileName of routeFiles) {
      if (ALLOWLIST[fileName]) continue; // explicit cross-practice exemption
      const finding = scanRouteFile(join(ROUTES_DIR, fileName), fileName);
      if (finding) findings.push(finding);
    }

    if (findings.length > 0) {
      const lines = findings.map(
        (f) =>
          `  ${f.file} — queries tenant-scoped models [${f.models.join(', ')}] without invoking any practice-scope helper.`,
      );
      throw new Error(
        `Tenant-scope coverage gap detected. The following route files write or read ` +
        `tenant-scoped tables without a practice-scope marker:\n\n${lines.join('\n')}\n\n` +
        `Fix one of three ways:\n` +
        `  (a) Use a scoping helper from middleware/practiceScope.middleware.ts — preferred\n` +
        `  (b) Reference req.practiceScope directly to make scope-awareness explicit\n` +
        `  (c) If the route legitimately operates cross-practice (external auth, ` +
        `system job), add it to ALLOWLIST in this test file with a justification.`,
      );
    }

    expect(findings).toHaveLength(0);
  });

  it('allowlist entries all have non-trivial justifications', () => {
    for (const [file, reason] of Object.entries(ALLOWLIST)) {
      expect(reason.length).toBeGreaterThan(30); // forces a real one-liner, not "ok"
      expect(file).toMatch(/\.routes\.ts$/);
    }
  });
});
