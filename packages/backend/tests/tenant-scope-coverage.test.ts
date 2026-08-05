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

const SCHEMA_PATH = join(__dirname, '..', 'prisma', 'schema.prisma');

/**
 * Derives tenant-scoped Prisma model accessors straight from schema.prisma:
 * any model declaring a practiceId or providerId field owns rows belonging to
 * one practice, so a route reading or writing it must scope.
 *
 * This used to be a hand-maintained list, and hand-maintenance is what failed.
 * The list held 33 entries while the schema had 64 qualifying models, so 31
 * were invisible to the guardrail — among them portalCredential,
 * providerAddress, userPractice, enrollmentOutcome and defactoSnapshot. A
 * model added to the schema is now covered the day it lands, with no second
 * list to remember to update.
 *
 * Model name -> client accessor is Prisma's own rule: lowercase the first
 * character, leave the rest alone (ProviderProfile -> providerProfile).
 */
function deriveTenantScopedModels(): string[] {
  const schema = readFileSync(SCHEMA_PATH, 'utf8');
  const models = [...schema.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)];
  return models
    .filter(([, , body]) => /^\s*(practiceId|providerId)\s+/m.test(body!))
    .map(([, name]) => name![0]!.toLowerCase() + name!.slice(1));
}

// Models with no practiceId/providerId column of their own, which the
// derivation above therefore cannot see, but which still hold per-practice
// rows through a deeper relation (enrollmentId -> providerId -> practiceId,
// conversationId, userId, subscriptionId, and so on). These stay
// hand-maintained because resolving them needs relation-graph traversal, not
// a field check — but the set is small and stops shrinking the moment a model
// gains a direct column, at which point derivation picks it up and the
// duplicate here is harmless.
const RELATION_SCOPED_MODELS = [
  'adminNotification',
  'aetnaEnrollmentRun',
  'agentEvent',
  'agentTask',
  'chatConversation',
  'chatMessage',
  'denialTriage',
  'enrollmentWorkflowStep',
  'followUpRun',
  'inAppNotification',
  'invoice',
  'pendingApproval',
  'providerCaqhMirror',
  'retellCallLog',
];

const DERIVED_TENANT_SCOPED_MODELS = deriveTenantScopedModels();

// Prisma model accessors whose underlying tables carry tenant-scoping
// (direct practiceId/providerId column OR reachable via a relation that does).
// Listed in camelCase matching Prisma client property names.
const TENANT_SCOPED_MODELS = Array.from(
  new Set([...DERIVED_TENANT_SCOPED_MODELS, ...RELATION_SCOPED_MODELS]),
);

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
//
// Hand-maintained on purpose for the one-off / non-identifier entries below,
// but reusable scope-check helpers (validate*/get*Filter/require*Provider)
// live in ONE canonical module — middleware/practiceScope.middleware.ts —
// so those are additionally auto-derived from that module's exports (see
// DERIVED_SCOPE_MARKERS below) and merged in. A future helper added there
// following the same naming convention is picked up without editing this
// list by hand. The two local one-off helpers below (assertDocumentAccess,
// denialScopeFilter) are each private to a single route file and are NOT
// exported from the canonical module, so they stay hand-maintained.
//
// Every identifier-shaped entry here (hand-picked or derived) is verified
// against the actual source in the self-validation tests below — a rename
// or deletion fails the suite loudly instead of silently orphaning the
// marker (see PR history: a stale marker sat unnoticed after a rename).
const SCOPE_MARKERS = [
  'getPracticeProviderFilter',
  'getPracticeRelationFilter',
  'validateProviderPracticeAccess',
  'validateEnrollmentAccess',
  'requirePracticeProvider',
  'assertDocumentAccess',  // local helper inside document.routes.ts
  'denialScopeFilter',     // local helper inside denial-triage.routes.ts
  'req.practiceScope',
  // Portal pattern: provider sees only their own data via req.user!.providerId.
  // This is a stricter form of scoping — self-access only — and is the
  // canonical pattern for /portal routes.
  'req.user!.providerId',
  'req.user?.providerId',
  'req.user.providerId',
  // Self-access by user id: the caller reads or writes only rows keyed to
  // themselves (notification.routes.ts resolves the caller's own practice via
  // `where: { userId: req.user!.id }`). Strictly narrower than practice scope
  // — one user rather than one practice — so it is genuine proof of scoping,
  // not an escape hatch.
  'req.user!.id',
  'req.user?.id',
  'req.user.id',
];

// The canonical module housing the reusable, cross-file practice-scope
// helpers. Every route file that scopes via a shared helper (as opposed to
// a private one-off like assertDocumentAccess/denialScopeFilter) imports
// from here.
const PRACTICE_SCOPE_MODULE = join(__dirname, '..', 'src', 'middleware', 'practiceScope.middleware.ts');

// Extracts exported function names from PRACTICE_SCOPE_MODULE, filtered to
// the naming pattern of genuine per-request/per-resource scope-check
// helpers: validate* (boolean access checks), get*Filter (Prisma where-
// clause builders), require*Provider (route middleware). This deliberately
// EXCLUDES the module's lifecycle-only exports (initPracticeScope,
// attachPracticeScope) — those populate req.practiceScope globally at the
// top of the request pipeline and are not, by themselves, proof that a
// specific route checked access to a specific resource.
function deriveCanonicalScopeHelperNames(): string[] {
  const src = readFileSync(PRACTICE_SCOPE_MODULE, 'utf8');
  const exportedFnRegex = /export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g;
  const names: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = exportedFnRegex.exec(src))) {
    names.push(match[1]!);
  }
  return names.filter(
    (n) => /^validate/.test(n) || /^get\w*Filter$/.test(n) || /^require\w*Provider$/.test(n)
  );
}

const DERIVED_SCOPE_MARKERS = deriveCanonicalScopeHelperNames();

// The actual marker set used for detection: hand list + auto-derived names,
// deduped. This is what scanRouteFile checks against.
const ALL_SCOPE_MARKERS = Array.from(new Set([...SCOPE_MARKERS, ...DERIVED_SCOPE_MARKERS]));

function isPlainIdentifier(marker: string): boolean {
  return /^[A-Za-z_$][\w$]*$/.test(marker);
}

// Every .ts source file under src/ (route files, middleware, services —
// helpers can legitimately live in any of them), read once up front so the
// self-validation checks below don't re-walk the tree per marker.
function walkTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkTsFiles(full));
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') && !entry.name.endsWith('.d.ts')) {
      out.push(full);
    }
  }
  return out;
}

const SRC_DIR = join(__dirname, '..', 'src');
const ALL_SRC_FILES = walkTsFiles(SRC_DIR).map((file) => ({ file, content: readFileSync(file, 'utf8') }));

// Resolves a plain-identifier marker to the file that defines it as a
// function or const, anywhere under src/. Returns null if no definition is
// found — the signal that the marker is orphaned (renamed/deleted helper).
function findSymbolDefinition(name: string): string | null {
  const defRegex = new RegExp(
    `(?:export\\s+)?(?:async\\s+)?function\\s+${name}\\s*\\(|(?:export\\s+)?const\\s+${name}\\s*[:=]`
  );
  const hit = ALL_SRC_FILES.find(({ content }) => defRegex.test(content));
  return hit ? hit.file : null;
}

// Routes that legitimately operate cross-practice. Each entry must have
// a justification. If you add to this list, the justification must
// explain WHY scope can be omitted (external auth, system job, etc.).
const ALLOWLIST: Record<string, string> = {
  'defacto.routes.ts':
    'Gated to admin + lanyard_staff, both cross-practice by design, so the ' +
    'ID lookups are intentionally unfiltered. If a practice-scoped role is ' +
    'ever added back to the authorize() list, remove this entry and scope the ' +
    'queries — that combination is what made this route a cross-practice leak.',
  'webhook.routes.ts':
    'External webhook authenticated by HMAC signature, not by user session. ' +
    'No req.user/practiceScope is available; lookup is by enrollmentId or ' +
    'NPI+payer pair. Cross-practice writes are intentional and expected.',
};

interface Finding {
  file: string;
  models: string[];
}

// Pure scan over already-read source text, parameterized on the marker set —
// factored out so tests can exercise detection against synthetic source
// without touching the filesystem or the real routes directory.
function scanRouteSource(src: string, fileName: string, markers: string[]): Finding | null {
  // Quick exit: if the file references any scope marker, it's covered.
  for (const marker of markers) {
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

function scanRouteFile(absPath: string, fileName: string): Finding | null {
  return scanRouteSource(readFileSync(absPath, 'utf8'), fileName, ALL_SCOPE_MARKERS);
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

/**
 * Self-validation: catches marker drift.
 *
 * SCOPE_MARKERS (and the derived names merged into ALL_SCOPE_MARKERS) are
 * matched against route source by plain substring search — cheap, but that
 * means a renamed or deleted helper doesn't error, it just silently stops
 * matching anything. The marker becomes permanent dead weight that LOOKS
 * like protection but provides none. This is exactly how a false positive
 * sat unnoticed previously. These tests fail loudly the moment that happens.
 */
describe('SCOPE_MARKERS self-validation (catches renamed/deleted helpers)', () => {
  it('every identifier-shaped marker resolves to a real function/const definition somewhere under src/', () => {
    const identifierMarkers = ALL_SCOPE_MARKERS.filter(isPlainIdentifier);
    expect(identifierMarkers.length).toBeGreaterThan(0); // sanity: the filter itself isn't broken

    const unresolved = identifierMarkers.filter((marker) => !findSymbolDefinition(marker));

    if (unresolved.length > 0) {
      throw new Error(
        `SCOPE_MARKERS/DERIVED_SCOPE_MARKERS contains identifier(s) with no matching ` +
        `function/const definition anywhere under src/: ${unresolved.join(', ')}\n\n` +
        `This means the helper was renamed or deleted — the marker can never match ` +
        `real source again, so it silently provides zero protection. Fix by updating ` +
        `the marker name (hand list) or investigating why derivation produced a name ` +
        `that no longer exists in practiceScope.middleware.ts.`
      );
    }

    expect(unresolved).toHaveLength(0);
  });

  it('every property-access-style marker (non-identifier) at least references req', () => {
    // These aren't resolvable symbols (they're expressions like req.practiceScope
    // or req.user!.providerId), but a typo here is just as silent as a rename —
    // sanity-check the shape instead.
    const nonIdentifierMarkers = ALL_SCOPE_MARKERS.filter((m) => !isPlainIdentifier(m));
    expect(nonIdentifierMarkers.length).toBeGreaterThan(0);

    const malformed = nonIdentifierMarkers.filter((m) => !/^req\b/.test(m));
    expect(malformed).toEqual([]);
  });
});

/**
 * Derivation sanity: DERIVED_SCOPE_MARKERS is built by regex over
 * practiceScope.middleware.ts's exports, filtered to a naming pattern
 * (validate-prefixed, get..Filter-suffixed, require..Provider-suffixed).
 * These tests pin down that the
 * filter draws the line where we intend — including the real per-request
 * access-check helpers, excluding the lifecycle-only helpers that merely
 * populate req.practiceScope and aren't themselves proof a route checked
 * access to a specific resource.
 */
describe('Canonical-module auto-derivation (practiceScope.middleware.ts)', () => {
  it('derives the known per-request scope-check helpers without a manual list edit', () => {
    expect(DERIVED_SCOPE_MARKERS).toEqual(
      expect.arrayContaining([
        'validateProviderPracticeAccess',
        'validatePracticeAccess',
        'validateEnrollmentAccess',
        'getPracticeProviderFilter',
        'getPracticeRelationFilter',
        'requirePracticeProvider',
      ])
    );
  });

  it('excludes lifecycle-only helpers that are not per-resource access proof', () => {
    // initPracticeScope/attachPracticeScope populate req.practiceScope globally
    // at the top of the pipeline (called from authenticate / global middleware).
    // Their presence in a route file's imports proves nothing about whether
    // THAT route checked THIS resource's scope — including them as markers
    // would let any file that merely imports the module skate past the guard.
    expect(DERIVED_SCOPE_MARKERS).not.toContain('initPracticeScope');
    expect(DERIVED_SCOPE_MARKERS).not.toContain('attachPracticeScope');
  });
});

/**
 * Schema auto-derivation: the model list is the other half of this guardrail,
 * and the half that failed. A marker list that works perfectly is worthless if
 * the model it should have flagged was never in the list. These tests pin the
 * derivation down the same way the marker tests pin the marker list down.
 */
describe('Schema auto-derivation (schema.prisma)', () => {
  it('derives every model that declares practiceId or providerId', () => {
    // Spot-check across the categories: provider data, credentials, practice
    // config, vendor state. All have a direct column in schema.prisma.
    expect(DERIVED_TENANT_SCOPED_MODELS).toEqual(
      expect.arrayContaining([
        'providerProfile',
        'enrollment',
        'document',
        'license',
        'practiceLocation',
        'task',
      ]),
    );
  });

  it('covers the models the old hand-maintained list silently missed', () => {
    // Every one of these was in schema.prisma with a tenant column while the
    // guardrail had no idea they existed. This is the regression that let an
    // unscoped route ship; if derivation ever stops covering them, it is back.
    expect(DERIVED_TENANT_SCOPED_MODELS).toEqual(
      expect.arrayContaining([
        'portalCredential',
        'providerAddress',
        'defactoSnapshot',
        'userPractice',
        'enrollmentOutcome',
        'practiceInvitation',
        'emailLog',
        'faxJob',
      ]),
    );
  });

  it('derives substantially more models than any hand list carried', () => {
    // Guards against a schema-format change silently reducing derivation to a
    // handful of matches, which would look like a pass while covering nothing.
    expect(DERIVED_TENANT_SCOPED_MODELS.length).toBeGreaterThan(50);
  });

  it('every hand-maintained relation-scoped entry still exists in the schema', () => {
    // Same drift problem as an orphaned scope marker: a renamed or deleted
    // model leaves an entry that can never match, looking like coverage while
    // providing none.
    const schema = readFileSync(SCHEMA_PATH, 'utf8');
    const declared = new Set(
      [...schema.matchAll(/^model\s+(\w+)\s*\{/gm)].map(
        (m) => m[1]![0]!.toLowerCase() + m[1]!.slice(1),
      ),
    );

    const orphaned = RELATION_SCOPED_MODELS.filter((m) => !declared.has(m));

    if (orphaned.length > 0) {
      throw new Error(
        `RELATION_SCOPED_MODELS names model(s) that no longer exist in ` +
        `schema.prisma: ${orphaned.join(', ')}\n\n` +
        `The model was renamed or removed, so the entry can never match a ` +
        `prisma.<model>.<op> call again. Update or delete it.`,
      );
    }

    expect(orphaned).toEqual([]);
  });

  it('flags a schema-derived model that no hand list would have caught', () => {
    // The end-to-end proof: portalCredential holds encrypted payer-portal
    // logins, appears nowhere in any hand-maintained list, and is caught only
    // because derivation read the schema.
    expect(RELATION_SCOPED_MODELS).not.toContain('portalCredential');

    const src = `
      import { prisma } from '../utils/prisma.js';
      router.get('/:id', async (req, res) => {
        const cred = await prisma.portalCredential.findFirst({ where: { id: req.params.id } });
        res.json(cred);
      });
    `;

    const finding = scanRouteSource(src, 'synthetic-portal-cred.routes.ts', ALL_SCOPE_MARKERS);

    expect(finding).not.toBeNull();
    expect(finding?.models).toContain('portalCredential.findFirst');
  });
});

/**
 * Detection-strength verification: hardening the marker list must not
 * weaken what the watchdog actually catches. These run the same scan logic
 * (scanRouteSource) against synthetic source instead of the real routes
 * directory, so they exercise both directions deterministically:
 *   - an unscoped file must still be flagged
 *   - a file scoped ONLY via the newly-derived marker must be exempted
 *     (proving derivation adds a genuinely working marker, not a no-op)
 */
describe('Detection guardrail strength (synthetic fixtures)', () => {
  it('still flags a file that queries a tenant-scoped model with no scope marker at all', () => {
    const unscopedSrc = `
      import { Router } from 'express';
      import { prisma } from '../utils/prisma.js';
      const router = Router();
      router.get('/', async (req, res) => {
        const rows = await prisma.enrollment.findMany({ where: {} });
        res.json(rows);
      });
      export default router;
    `;

    const finding = scanRouteSource(unscopedSrc, 'synthetic-unscoped.routes.ts', ALL_SCOPE_MARKERS);

    expect(finding).not.toBeNull();
    expect(finding?.models).toContain('enrollment.findMany');
  });

  it('exempts a file scoped only via the auto-derived validatePracticeAccess marker', () => {
    const scopedSrc = `
      import { Router } from 'express';
      import { prisma } from '../utils/prisma.js';
      import { validatePracticeAccess } from '../middleware/practiceScope.middleware.js';
      const router = Router();
      router.post('/:practiceId', async (req, res) => {
        if (!validatePracticeAccess(req, req.params.practiceId)) {
          return res.status(404).json({ error: 'not found' });
        }
        const rows = await prisma.enrollment.findMany({ where: {} });
        res.json(rows);
      });
      export default router;
    `;

    const finding = scanRouteSource(scopedSrc, 'synthetic-scoped.routes.ts', ALL_SCOPE_MARKERS);

    expect(finding).toBeNull();
  });

  it('does NOT exempt that same file if derivation is disabled (would fail without it — proves derivation, not the hand list, is what covers it)', () => {
    const scopedSrc = `
      import { validatePracticeAccess } from '../middleware/practiceScope.middleware.js';
      router.post('/:practiceId', async (req, res) => {
        if (!validatePracticeAccess(req, req.params.practiceId)) return res.status(404).end();
        const rows = await prisma.enrollment.findMany({ where: {} });
      });
    `;

    const findingWithHandListOnly = scanRouteSource(scopedSrc, 'synthetic-scoped.routes.ts', SCOPE_MARKERS);
    expect(findingWithHandListOnly).not.toBeNull(); // hand list alone doesn't know validatePracticeAccess

    const findingWithDerivedMerged = scanRouteSource(scopedSrc, 'synthetic-scoped.routes.ts', ALL_SCOPE_MARKERS);
    expect(findingWithDerivedMerged).toBeNull(); // merged list does
  });
});
