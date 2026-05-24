/**
 * UnitedHealthcare Workflow Seed — Phase 3 of payer-workflows.json → DB migration.
 *
 * Creates 1 WorkflowTemplate row for UHC Medical (7 steps). UHC has no behavioral
 * health workflow — all BH credentialing routes to Optum Behavioral Health (handled
 * separately in Phase 4). The DB confirms this: only one UHC PayerTrack exists
 * (United Healthcare / Medical / Primary Care / Nationwide).
 *
 * Replaces legacy Path B (JSON hydration) for UHC only; remaining payers (Optum,
 * Humana) continue using Path B until their respective seeds ship.
 *
 * Notable UHC-specific bits encoded here:
 *   - The `bh_routing` note from the JSON ("All BH credentialing routes to Optum
 *     Behavioral Health") lives in the WorkflowTemplate description so staff see
 *     it whenever they open the UHC workflow.
 *   - uhc-med-03 (PSV) has `site_visit_trigger: 'high_risk_specialties'` in the
 *     JSON. The source list of which specialties trigger a site visit is NOT
 *     defined upstream, so we preserve the marker in the step's metadata and DO
 *     NOT create a separate WorkflowTemplateCondition. When the high-risk list
 *     becomes known, add a condition row keyed on `provider_type` with the
 *     enumerated specialties and `action='add_step'`.
 *   - uhc-med-04 (committee review) has no explicit possible_outcomes in the
 *     JSON but the implicit ones are approved / denied / additional_info_needed;
 *     we encode them so downstream rows (med-05/06/07 contracting + activation)
 *     gate correctly on `previous_outcome='approved'`.
 *
 * Idempotency: same dance as Aetna + Cigna seeds — null out enrollment FKs, delete
 * existing UHC templates, recreate.
 *
 * Usage:
 *   npx tsx packages/backend/prisma/seeds/payerWorkflows/uhc.seed.ts
 *   npx tsx packages/backend/prisma/seeds/payerWorkflows/uhc.seed.ts --dry-run
 */

import { PrismaClient, Prisma } from '@prisma/client';

const DRY_RUN = process.argv.includes('--dry-run');
const SYSTEM_USER = 'system-seed';

// PayerTrack values — confirmed via:
//   SELECT payer_name, track FROM payer_tracks WHERE payer_name ILIKE '%united%';
// Note: DB stores "United Healthcare" (two words), not the JSON key "uhc" or the
// marketing name "UnitedHealthcare".
const PAYER_NAME = 'United Healthcare';
const STATE_REGION = 'Nationwide';
const MEDICAL_TRACK = 'Medical / Primary Care';

// ─── Step + condition definitions ───────────────────────────────────────────

interface StepInput {
  stepOrder: number;
  name: string;
  description: string;
  stepType: string;
  owner: string;
  requiredDocuments?: string[];
  triggerDaysAfterPrev?: number | null;
  isBlocking?: boolean;
  reviewerInstructions?: string | null;
  url?: string | null;
  estimatedDaysMin?: number | null;
  estimatedDaysMax?: number | null;
  warnings?: string[];
  possibleOutcomes?: string[];
  actionType?: string | null;
  metadata?: Prisma.InputJsonValue | null;
}

interface ConditionInput {
  conditionType: string;
  conditionValue: string;
  conditionValues?: string[];
  action: string;
  targetStepOrder: number;
  stepDefinition?: Prisma.InputJsonValue | null;
}

// UHC Medical — 7 steps, sourced from payer-workflows.json lines 278–344.
const MEDICAL_STEPS: StepInput[] = [
  {
    stepOrder: 1,
    name: 'Create One Healthcare ID',
    description:
      'Register for a One Healthcare ID at uhcprovider.com. This is the shared SSO across UHC and Optum.',
    stepType: 'submit_application',
    owner: 'provider',
    triggerDaysAfterPrev: null,
    isBlocking: true,
    url: 'https://www.uhcprovider.com',
    estimatedDaysMin: 1,
    estimatedDaysMax: 1,
    actionType: 'account_creation',
  },
  {
    stepOrder: 2,
    name: 'Complete Onboard Pro Application',
    description:
      'Enter legal name, business name, TIN, state, and lines of business. Onboard Pro runs a pre-credentialing check and auto-populates from CAQH ProView.',
    stepType: 'submit_application',
    owner: 'provider',
    requiredDocuments: [
      'doc-npi',
      'doc-license',
      'doc-dea',
      'doc-malpractice',
      'doc-w9',
      'doc-board-cert',
      'doc-cv',
      'doc-caqh',
    ],
    triggerDaysAfterPrev: 1,
    isBlocking: true,
    estimatedDaysMin: 1,
    estimatedDaysMax: 1,
    actionType: 'form_submission',
  },
  {
    stepOrder: 3,
    name: 'Primary Source Verification',
    description:
      'UHC conducts verification following NCQA standards: OIG, SAM.gov, NPDB, state sanctions databases. Site visits may occur for high-risk specialties.',
    stepType: 'await_decision',
    owner: 'payer',
    triggerDaysAfterPrev: 1,
    isBlocking: true,
    estimatedDaysMin: 14,
    estimatedDaysMax: 30,
    actionType: 'payer_review',
    metadata: {
      verification_sources: ['OIG', 'SAM.gov', 'NPDB', 'state_sanctions'],
      site_visit_trigger: 'high_risk_specialties',
      site_visit_specialties_list: 'not_enumerated_upstream',
    },
  },
  {
    stepOrder: 4,
    name: 'National Credentialing Committee Review',
    description: 'Committee reviews and decides within 30 calendar days.',
    stepType: 'await_decision',
    owner: 'payer',
    triggerDaysAfterPrev: 1,
    isBlocking: true,
    estimatedDaysMin: 30,
    estimatedDaysMax: 30,
    possibleOutcomes: ['approved', 'denied', 'additional_info_needed'],
    actionType: 'committee_review',
  },
  {
    stepOrder: 5,
    name: 'Receive Participation Agreement',
    description:
      'Upon approval, Onboard Pro automatically triggers contracting. Participation Agreement mailed within 5 business days.',
    stepType: 'await_decision',
    owner: 'payer',
    triggerDaysAfterPrev: 1,
    isBlocking: true,
    estimatedDaysMin: 5,
    estimatedDaysMax: 5,
    actionType: 'contract_delivery',
    metadata: { method: 'mail', condition: 'approved' },
  },
  {
    stepOrder: 6,
    name: 'Sign and Return Agreement',
    description: 'Review, sign, and return the Participation Agreement.',
    stepType: 'submit_application',
    owner: 'provider',
    triggerDaysAfterPrev: 1,
    isBlocking: true,
    estimatedDaysMin: 3,
    estimatedDaysMax: 7,
    actionType: 'contract_execution',
  },
  {
    stepOrder: 7,
    name: 'Network Activation',
    description:
      'Provider becomes active in UHC network. Status trackable via Onboard Pro real-time dashboard with projected completion dates.',
    stepType: 'record_outcome',
    owner: 'payer',
    triggerDaysAfterPrev: 1,
    isBlocking: true,
    estimatedDaysMin: 5,
    estimatedDaysMax: 14,
    actionType: 'confirmation',
    metadata: { condition: 'approved' },
  },
];

// Conditions: gate steps 5/6/7 (contracting + activation) on uhc-med-04 outcome.
// Only 'approved' should proceed. Skip rows for the other outcomes target each
// downstream step so a denied/incomplete decision halts the workflow correctly.
const MEDICAL_CONDITIONS: ConditionInput[] = [
  { conditionType: 'previous_outcome', conditionValue: 'denied', action: 'skip_step', targetStepOrder: 5 },
  { conditionType: 'previous_outcome', conditionValue: 'additional_info_needed', action: 'skip_step', targetStepOrder: 5 },
  { conditionType: 'previous_outcome', conditionValue: 'denied', action: 'skip_step', targetStepOrder: 6 },
  { conditionType: 'previous_outcome', conditionValue: 'additional_info_needed', action: 'skip_step', targetStepOrder: 6 },
  { conditionType: 'previous_outcome', conditionValue: 'denied', action: 'skip_step', targetStepOrder: 7 },
  { conditionType: 'previous_outcome', conditionValue: 'additional_info_needed', action: 'skip_step', targetStepOrder: 7 },
];

// ─── Seed function ──────────────────────────────────────────────────────────

export interface SeedResult {
  payerTracksFound: number;
  payerTracksMissing: string[];
  workflowTemplatesCreated: number;
  workflowStepsCreated: number;
  conditionsCreated: number;
  enrollmentsRelinked: number;
}

interface TrackPlan {
  payerName: string;
  track: string;
  templateName: string;
  templateDescription: string;
  steps: StepInput[];
  conditions: ConditionInput[];
}

export async function seedUhc(
  prisma: PrismaClient,
  opts: { dryRun?: boolean } = {}
): Promise<SeedResult> {
  const dryRun = opts.dryRun ?? false;

  const result: SeedResult = {
    payerTracksFound: 0,
    payerTracksMissing: [],
    workflowTemplatesCreated: 0,
    workflowStepsCreated: 0,
    conditionsCreated: 0,
    enrollmentsRelinked: 0,
  };

  const trackPlans: TrackPlan[] = [
    {
      payerName: PAYER_NAME,
      track: MEDICAL_TRACK,
      templateName: 'UnitedHealthcare Medical Provider Enrollment',
      templateDescription:
        'UnitedHealthcare medical-panel credentialing & enrollment workflow. Official timeline: 14–45 calendar days. Real-world: 60–120 calendar days. Re-credentialing every 36 months; CAQH attestation window 120 days. Submitted through Onboard Pro (https://www.uhcprovider.com). BH ROUTING: UHC does not credential behavioral health providers directly — all BH credentialing routes to Optum Behavioral Health (see the Optum workflow).',
      steps: MEDICAL_STEPS,
      conditions: MEDICAL_CONDITIONS,
    },
  ];

  // 1. Resolve PayerTrack IDs. Tracks must already exist (knowledge base seed owns creation).
  const trackIdsByKey: Record<string, string> = {};
  for (const plan of trackPlans) {
    const existing = await prisma.payerTrack.findUnique({
      where: {
        payerName_track_stateRegion: {
          payerName: plan.payerName,
          track: plan.track,
          stateRegion: STATE_REGION,
        },
      },
    });
    const key = `${plan.payerName}::${plan.track}`;
    if (existing) {
      result.payerTracksFound++;
      trackIdsByKey[key] = existing.id;
    } else {
      result.payerTracksMissing.push(`${plan.payerName} / ${plan.track} / ${STATE_REGION}`);
    }
  }

  if (result.payerTracksMissing.length > 0 && !dryRun) {
    throw new Error(
      `UHC seed cannot proceed — missing PayerTrack rows: ${result.payerTracksMissing.join('; ')}. Run the knowledge base seed first.`
    );
  }

  // 2. Null out enrollment FKs and delete existing templates for these tracks.
  const trackIds = Object.values(trackIdsByKey);
  if (trackIds.length > 0 && !dryRun) {
    const existingTemplates = await prisma.workflowTemplate.findMany({
      where: { payerTrackId: { in: trackIds } },
      select: { id: true },
    });
    if (existingTemplates.length > 0) {
      const templateIds = existingTemplates.map((t) => t.id);
      const relinked = await prisma.enrollment.updateMany({
        where: { workflowTemplateId: { in: templateIds } },
        data: { workflowTemplateId: null },
      });
      result.enrollmentsRelinked = relinked.count;
      await prisma.workflowTemplate.deleteMany({ where: { id: { in: templateIds } } });
    }
  }

  // 3. Create templates + steps + conditions.
  for (const plan of trackPlans) {
    const key = `${plan.payerName}::${plan.track}`;
    const trackId = trackIdsByKey[key];

    if (dryRun) {
      console.log(
        `  [WORKFLOW] ${plan.templateName}: ${plan.steps.length} steps, ${plan.conditions.length} conditions (track: ${plan.payerName} / ${plan.track})`
      );
      result.workflowTemplatesCreated++;
      result.workflowStepsCreated += plan.steps.length;
      result.conditionsCreated += plan.conditions.length;
      continue;
    }

    if (!trackId) continue;

    const now = new Date();
    const template = await prisma.workflowTemplate.create({
      data: {
        payerTrackId: trackId,
        name: plan.templateName,
        version: 1,
        status: 'active',
        description: plan.templateDescription,
        createdBy: SYSTEM_USER,
        publishedAt: now,
        updatedAt: now,
      },
    });
    result.workflowTemplatesCreated++;

    for (const step of plan.steps) {
      await prisma.workflowTemplateStep.create({
        data: {
          templateId: template.id,
          stepOrder: step.stepOrder,
          name: step.name,
          description: step.description ?? null,
          stepType: step.stepType,
          owner: step.owner,
          requiredDocuments: step.requiredDocuments ?? [],
          triggerDaysAfterPrev: step.triggerDaysAfterPrev ?? null,
          isBlocking: step.isBlocking ?? true,
          reviewerInstructions: step.reviewerInstructions ?? null,
          url: step.url ?? null,
          estimatedDaysMin: step.estimatedDaysMin ?? null,
          estimatedDaysMax: step.estimatedDaysMax ?? null,
          warnings: step.warnings ?? [],
          possibleOutcomes: step.possibleOutcomes ?? [],
          actionType: step.actionType ?? null,
          metadata: step.metadata ?? Prisma.JsonNull,
        },
      });
      result.workflowStepsCreated++;
    }

    for (const cond of plan.conditions) {
      await prisma.workflowTemplateCondition.create({
        data: {
          templateId: template.id,
          conditionType: cond.conditionType,
          conditionValue: cond.conditionValue,
          conditionValues: cond.conditionValues ?? [],
          action: cond.action,
          targetStepOrder: cond.targetStepOrder,
          stepDefinition: cond.stepDefinition ?? Prisma.JsonNull,
        },
      });
      result.conditionsCreated++;
    }
  }

  return result;
}

// ─── CLI entry point ────────────────────────────────────────────────────────

async function main() {
  const prisma = new PrismaClient();
  try {
    console.log(`\n🌱 UnitedHealthcare workflow seed${DRY_RUN ? ' (dry-run)' : ''}\n`);
    const result = await seedUhc(prisma, { dryRun: DRY_RUN });
    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('  SUMMARY');
    console.log('═══════════════════════════════════════════════════════════');
    console.log(`  PayerTracks found:       ${result.payerTracksFound}`);
    if (result.payerTracksMissing.length > 0) {
      console.log(`  PayerTracks MISSING:     ${result.payerTracksMissing.join(', ')}`);
    }
    console.log(`  WorkflowTemplates:       ${result.workflowTemplatesCreated}`);
    console.log(`  WorkflowTemplateSteps:   ${result.workflowStepsCreated}`);
    console.log(`  Conditions:              ${result.conditionsCreated}`);
    console.log(`  Enrollments re-linked:   ${result.enrollmentsRelinked}`);
    console.log('═══════════════════════════════════════════════════════════\n');
  } finally {
    await prisma.$disconnect();
  }
}

const invokedDirectly =
  process.argv[1]?.endsWith('uhc.seed.ts') || process.argv[1]?.endsWith('uhc.seed.js');
if (invokedDirectly) {
  main().catch((err) => {
    console.error('UHC seed failed:', err);
    process.exit(1);
  });
}
