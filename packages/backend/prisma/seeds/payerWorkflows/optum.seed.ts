/**
 * Optum Behavioral Health Workflow Seed — Phase 4 of payer-workflows.json → DB migration.
 *
 * Creates 1 WorkflowTemplate row for Optum BH (8 steps). Optum has no medical
 * workflow — it is the BH credentialing arm of UnitedHealth Group (operating as
 * United Behavioral Health / UBH). The DB has two Optum PayerTracks (Behavioral
 * Health + Physical Health) but the JSON only defines the BH workflow; the
 * Physical Health track keeps its auto-generated 10-step generic template.
 *
 * Replaces legacy Path B (JSON hydration) for Optum only; Humana remains on
 * Path B until its seed ships in Phase 5.
 *
 * Notable Optum-specific bits encoded here:
 *   - optum-bh-01 carries the #1 Optum-specific enrollment error warning:
 *     authorize "United Behavioral Health" (Agency ID 1354) in CAQH, NOT
 *     "UnitedHealthcare". Same SSO as UHC (shared One Healthcare ID).
 *   - optum-bh-07 ("Data Loading") is a distinct step rather than a side-effect
 *     of approval — Optum has a known 5–30 business-day lag between committee
 *     approval and provider being live in claims / directories. The JSON
 *     preserves this as a step, so we do too.
 *   - Operating-entity context (UBH / Verisys CVO / EDI 87726 / network list)
 *     stored on the WorkflowTemplate description and step metadata so it
 *     surfaces to staff during enrollment.
 *
 * Conditions: optum-bh-06 (committee review) has no explicit possible_outcomes
 * in the JSON, but the implicit set is approved / denied / additional_info_needed.
 * We encode them and add skip rows so optum-bh-07 (data loading) and optum-bh-08
 * (live in network) only run on approval — matches the Aetna + Cigna + UHC
 * pattern.
 *
 * Idempotency: same dance as prior seeds — null out enrollment FKs, delete
 * existing Optum BH templates, recreate.
 *
 * Usage:
 *   npx tsx packages/backend/prisma/seeds/payerWorkflows/optum.seed.ts
 *   npx tsx packages/backend/prisma/seeds/payerWorkflows/optum.seed.ts --dry-run
 */

import { PrismaClient, Prisma } from '@prisma/client';

const DRY_RUN = process.argv.includes('--dry-run');
const SYSTEM_USER = 'system-seed';

// PayerTrack values — confirmed via:
//   SELECT payer_name, track FROM payer_tracks WHERE payer_name ILIKE 'optum%';
// The DB also has "Optum Physical Health / Physical Health" which is NOT migrated
// here — the JSON has no Physical Health workflow definition.
const PAYER_NAME = 'Optum Behavioral Health';
const STATE_REGION = 'Nationwide';
const BH_TRACK = 'Behavioral Health';

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

// Optum BH — 8 steps, sourced from payer-workflows.json lines 290–368.
const BH_STEPS: StepInput[] = [
  {
    stepOrder: 1,
    name: 'Authorize UBH in CAQH ProView',
    description:
      "Authorize 'United Behavioral Health' (Agency ID# 1354) in CAQH data sharing. This is the #1 Optum-specific enrollment error — providers often authorize 'UnitedHealthcare' instead.",
    stepType: 'submit_application',
    owner: 'provider',
    triggerDaysAfterPrev: null,
    isBlocking: true,
    estimatedDaysMin: 1,
    estimatedDaysMax: 1,
    warnings: [
      "Must authorize 'United Behavioral Health' — NOT 'UnitedHealthcare'. Agency ID: 1354.",
    ],
    actionType: 'caqh_update',
    metadata: { caqh_authorization_name: 'United Behavioral Health', caqh_agency_id: '1354' },
  },
  {
    stepOrder: 2,
    name: 'Create One Healthcare ID',
    description: 'Register at providerexpress.com using shared SSO (same as UHC).',
    stepType: 'submit_application',
    owner: 'provider',
    triggerDaysAfterPrev: 1,
    isBlocking: true,
    url: 'https://www.providerexpress.com',
    estimatedDaysMin: 1,
    estimatedDaysMax: 1,
    actionType: 'account_creation',
  },
  {
    stepOrder: 3,
    name: 'Submit Network Participation Request Form (NPRF)',
    description: 'Complete the NPRF online through Provider Express.',
    stepType: 'submit_application',
    owner: 'provider',
    requiredDocuments: [
      'doc-npi',
      'doc-license',
      'doc-dea',
      'doc-malpractice',
      'doc-w9',
      'doc-peer-refs',
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
    stepOrder: 4,
    name: 'Sign Individual Agreement via DocuSign',
    description:
      'Optum sends Individual Agreement via DocuSign for electronic signature.',
    stepType: 'submit_application',
    owner: 'provider',
    triggerDaysAfterPrev: 1,
    isBlocking: true,
    estimatedDaysMin: 3,
    estimatedDaysMax: 7,
    actionType: 'contract_execution',
    metadata: { method: 'DocuSign' },
  },
  {
    stepOrder: 5,
    name: 'Primary Source Verification (Verisys)',
    description:
      'Verisys (NCQA-certified CVO, formerly Aperture) conducts full verification including licensure, DEA, education, malpractice, NPDB, OIG/SAM, work history, and peer references.',
    stepType: 'await_decision',
    owner: 'payer',
    triggerDaysAfterPrev: 1,
    isBlocking: true,
    estimatedDaysMin: 45,
    estimatedDaysMax: 60,
    actionType: 'payer_review',
    metadata: {
      cvo: 'Verisys',
      cvo_former_name: 'Aperture',
      verification_items: [
        'licensure',
        'DEA',
        'education',
        'malpractice',
        'NPDB',
        'OIG_SAM',
        'work_history',
        'peer_references',
      ],
    },
  },
  {
    stepOrder: 6,
    name: 'Credentialing Committee Review',
    description:
      'Standing Credentialing Committee (operating under Quality Improvement Committee authority) reviews and decides.',
    stepType: 'await_decision',
    owner: 'payer',
    triggerDaysAfterPrev: 1,
    isBlocking: true,
    estimatedDaysMin: 14,
    estimatedDaysMax: 30,
    possibleOutcomes: ['approved', 'denied', 'additional_info_needed'],
    actionType: 'committee_review',
  },
  {
    stepOrder: 7,
    name: 'Data Loading (Post-Approval)',
    description:
      'After approval, provider data is loaded into claims systems and directories. This is a known lag unique to Optum.',
    stepType: 'await_decision',
    owner: 'payer',
    triggerDaysAfterPrev: 1,
    isBlocking: true,
    estimatedDaysMin: 5,
    estimatedDaysMax: 30,
    warnings: [
      'Providers are approved but cannot bill or be found in directories until data loading completes. Track via Initial Credentialing Status Toolbar in Provider Express.',
    ],
    actionType: 'system_processing',
    metadata: { condition: 'approved', estimated_days_unit: 'business_days' },
  },
  {
    stepOrder: 8,
    name: 'Live in Network',
    description: 'Provider is active in claims systems and provider directories.',
    stepType: 'record_outcome',
    owner: 'payer',
    triggerDaysAfterPrev: 1,
    isBlocking: true,
    estimatedDaysMin: 1,
    estimatedDaysMax: 1,
    actionType: 'confirmation',
    metadata: { condition: 'approved' },
  },
];

// Conditions: gate optum-bh-07 (data loading) and optum-bh-08 (live in network)
// on optum-bh-06 outcome. Only 'approved' should proceed; skip rows for other
// outcomes target each downstream step.
const BH_CONDITIONS: ConditionInput[] = [
  { conditionType: 'previous_outcome', conditionValue: 'denied', action: 'skip_step', targetStepOrder: 7 },
  { conditionType: 'previous_outcome', conditionValue: 'additional_info_needed', action: 'skip_step', targetStepOrder: 7 },
  { conditionType: 'previous_outcome', conditionValue: 'denied', action: 'skip_step', targetStepOrder: 8 },
  { conditionType: 'previous_outcome', conditionValue: 'additional_info_needed', action: 'skip_step', targetStepOrder: 8 },
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

export async function seedOptum(
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
      track: BH_TRACK,
      templateName: 'Optum Behavioral Health Provider Enrollment',
      templateDescription:
        'Optum (United Behavioral Health / UBH) credentialing & enrollment workflow. Official timeline: 60–90 calendar days credentialing + an additional 5–30 business days for data loading. Real-world: 90–120+ calendar days. CVO: Verisys (NCQA-certified, formerly Aperture). EDI Payer ID 87726 covers all UHC/Optum/UBH BH claims. CAQH must authorize "United Behavioral Health" (Agency ID 1354) — NOT "UnitedHealthcare". Enrolling in UHC does NOT enroll in Optum. Independent licensure required — no provisional or supervisory-dependent licenses. Networks: Commercial/Employer, Medicare Advantage (BH), Medicaid/Community Plan, EAP, Express Access, Autism/ABA.',
      steps: BH_STEPS,
      conditions: BH_CONDITIONS,
    },
  ];

  // 1. Resolve PayerTrack IDs.
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
      `Optum seed cannot proceed — missing PayerTrack rows: ${result.payerTracksMissing.join('; ')}. Run the knowledge base seed first.`
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
    console.log(`\n🌱 Optum Behavioral Health workflow seed${DRY_RUN ? ' (dry-run)' : ''}\n`);
    const result = await seedOptum(prisma, { dryRun: DRY_RUN });
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
  process.argv[1]?.endsWith('optum.seed.ts') || process.argv[1]?.endsWith('optum.seed.js');
if (invokedDirectly) {
  main().catch((err) => {
    console.error('Optum seed failed:', err);
    process.exit(1);
  });
}
