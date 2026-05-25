/**
 * Aetna Workflow Seed — Phase 1 of payer-workflows.json → DB migration.
 *
 * Creates DB-backed WorkflowTemplate rows for Aetna Medical + Aetna Behavioral Health.
 * Replaces the legacy Path B (JSON hydration) for Aetna only; other payers (Cigna, UHC,
 * Optum, Humana) continue to use Path B until their respective seeds ship.
 *
 * What this seed creates / upserts:
 *   - 2 PayerTrack rows: "Aetna / Medical / Nationwide" and "Aetna / Behavioral Health / Nationwide"
 *   - 2 WorkflowTemplate rows (v1, status=active), one per PayerTrack
 *   - 14 WorkflowTemplateStep rows (7 medical + 7 BH), faithful copies of the JSON content
 *     including the new fields added in the Phase 0 schema migration: url, estimatedDaysMin/Max,
 *     warnings, possibleOutcomes, actionType, metadata.
 *   - WorkflowTemplateCondition rows that gate steps with `condition: "panel_open"` (med-03) and
 *     `condition: "approved"` (med-07, bh-07). Modeled as skip_step rows keyed off
 *     conditionType='previous_outcome'. Each gated step gets one row per disjoint "skip" outcome.
 *
 * Idempotency: re-runs are safe. Steps:
 *   1. Find Aetna PayerTracks by payerName == 'Aetna'.
 *   2. Null out enrollment.workflowTemplateId on any enrollments that reference current Aetna templates
 *      so the deleteMany doesn't fail with FK violation.
 *   3. Delete existing Aetna WorkflowTemplates (cascade-deletes steps and conditions per schema).
 *   4. Upsert PayerTracks, then create templates + steps + conditions fresh.
 *
 * Usage:
 *   npx tsx packages/backend/prisma/seeds/payerWorkflows/aetna.seed.ts
 *   npx tsx packages/backend/prisma/seeds/payerWorkflows/aetna.seed.ts --dry-run
 */

import { PrismaClient, Prisma } from '@prisma/client';

const DRY_RUN = process.argv.includes('--dry-run');
const SYSTEM_USER = 'system-seed';

const PAYER_NAME = 'Aetna';
const STATE_REGION = 'Nationwide';
// Track name MUST match the existing PayerTrack row created by the knowledgeBase seed,
// otherwise we'd create a duplicate Aetna PayerTrack alongside the existing one.
const MEDICAL_TRACK = 'Medical / Primary Care';
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

// Aetna Medical — 7 steps, sourced from payer-workflows.json lines 278–352.
const MEDICAL_STEPS: StepInput[] = [
  {
    stepOrder: 1,
    name: 'Submit Request for Participation',
    description: "Complete the online Request for Participation form on Aetna's provider enrollment page.",
    stepType: 'submit_application',
    owner: 'provider',
    requiredDocuments: ['doc-npi', 'doc-caqh'],
    triggerDaysAfterPrev: null,
    isBlocking: true,
    url: 'https://www.aetna.com/health-care-professionals/join-the-aetna-network.html',
    estimatedDaysMin: 1,
    estimatedDaysMax: 1,
    warnings: ['Use the MEDICAL form — not the BH form. Using the wrong form is a common costly error.'],
    actionType: 'form_submission',
  },
  {
    stepOrder: 2,
    name: 'Network Need Assessment',
    description: 'Aetna evaluates geographic need for your specialty. This determines whether the panel is open or closed in your area.',
    stepType: 'await_decision',
    owner: 'payer',
    triggerDaysAfterPrev: 1,
    isBlocking: true,
    estimatedDaysMin: 45,
    estimatedDaysMax: 60,
    possibleOutcomes: ['panel_open', 'panel_closed'],
    actionType: 'payer_review',
    metadata: { outcome_if_denied: 'Denial letter received. Provider can reapply later or request reconsideration.' },
  },
  {
    stepOrder: 3,
    name: 'Receive & Review Provider Participation Agreement',
    description: 'If panel is open, Aetna Network Manager sends Provider Participation Agreement via email.',
    stepType: 'human_review',
    owner: 'provider',
    triggerDaysAfterPrev: 1,
    isBlocking: true,
    estimatedDaysMin: 5,
    estimatedDaysMax: 10,
    warnings: ['Request detailed fee schedules before signing. Multiple sources report Aetna sometimes sends contracts without clear reimbursement details.'],
    actionType: 'document_review',
    metadata: { condition: 'panel_open' },
  },
  {
    stepOrder: 4,
    name: 'Sign and Return Contract',
    description: 'Review fee schedule, sign Provider Participation Agreement, and return to Aetna.',
    stepType: 'submit_application',
    owner: 'provider',
    triggerDaysAfterPrev: 1,
    isBlocking: true,
    estimatedDaysMin: 1,
    estimatedDaysMax: 5,
    actionType: 'contract_execution',
  },
  {
    stepOrder: 5,
    name: 'Primary Source Verification (Credentialing)',
    description: "Aetna's CVO (3Won/ProVault) verifies licensure, DEA, education, board certification, malpractice history, NPDB, OIG/SAM exclusions, and work history.",
    stepType: 'await_decision',
    owner: 'payer',
    triggerDaysAfterPrev: 1,
    isBlocking: true,
    estimatedDaysMin: 30,
    estimatedDaysMax: 45,
    actionType: 'payer_review',
    metadata: {
      verification_items: ['licensure', 'DEA', 'education', 'board_certification', 'malpractice_history', 'NPDB', 'OIG_SAM', 'work_history'],
      cvo: '3Won/ProVault',
    },
  },
  {
    stepOrder: 6,
    name: 'Credentialing Committee Review',
    description: 'Credentialing committee reviews complete file and communicates decision in writing.',
    stepType: 'await_decision',
    owner: 'payer',
    triggerDaysAfterPrev: 1,
    isBlocking: true,
    estimatedDaysMin: 7,
    estimatedDaysMax: 14,
    possibleOutcomes: ['approved', 'denied', 'additional_info_needed'],
    actionType: 'committee_review',
  },
  {
    stepOrder: 7,
    name: 'Network Effective Date Confirmed',
    description: 'Provider receives approval letter with network effective date. Provider is now live in Aetna network.',
    stepType: 'record_outcome',
    owner: 'payer',
    triggerDaysAfterPrev: 1,
    isBlocking: true,
    estimatedDaysMin: 5,
    estimatedDaysMax: 10,
    actionType: 'confirmation',
    metadata: { condition: 'approved' },
  },
];

// Aetna Behavioral Health — 7 steps, sourced from payer-workflows.json lines 365–434.
const BH_STEPS: StepInput[] = [
  {
    stepOrder: 1,
    name: 'Submit Behavioral Health Request for Participation',
    description: 'Complete the dedicated BH application form (different from medical form).',
    stepType: 'submit_application',
    owner: 'provider',
    requiredDocuments: ['doc-npi', 'doc-caqh', 'doc-license', 'doc-malpractice'],
    triggerDaysAfterPrev: null,
    isBlocking: true,
    url: 'https://www.aetna.com/health-care-professionals/forms/behavioral-health-application.html',
    estimatedDaysMin: 1,
    estimatedDaysMax: 1,
    warnings: ['Do NOT use the general medical enrollment form. BH has its own form.'],
    actionType: 'form_submission',
  },
  {
    stepOrder: 2,
    name: 'Network Need Assessment (BH)',
    description: 'Aetna assesses geographic and specialty need for behavioral health. This step often takes longer for BH than medical.',
    stepType: 'await_decision',
    owner: 'payer',
    triggerDaysAfterPrev: 1,
    isBlocking: true,
    estimatedDaysMin: 45,
    estimatedDaysMax: 90,
    actionType: 'payer_review',
  },
  {
    stepOrder: 3,
    name: 'Third-Party Delegation Routing',
    description: 'Aetna may route BH credentialing to a delegated entity (often Optum/UBH). Provider may need to interact with both Aetna and the delegated entity.',
    stepType: 'await_decision',
    owner: 'payer',
    triggerDaysAfterPrev: 1,
    isBlocking: false,
    estimatedDaysMin: 14,
    estimatedDaysMax: 30,
    warnings: ['This step is unique to Aetna and is the primary reason for extended BH timelines.'],
    actionType: 'payer_internal',
    metadata: { conditional: true, common_delegate: 'Optum / UBH' },
  },
  {
    stepOrder: 4,
    name: 'Receive & Sign BH Participation Agreement',
    description: 'Review and sign the behavioral health-specific participation agreement.',
    stepType: 'submit_application',
    owner: 'provider',
    triggerDaysAfterPrev: 1,
    isBlocking: true,
    estimatedDaysMin: 5,
    estimatedDaysMax: 10,
    actionType: 'contract_execution',
  },
  {
    stepOrder: 5,
    name: 'Primary Source Verification (BH Credentialing)',
    description: 'CVO conducts full verification. May be processed by Aetna\'s CVO or delegated entity.',
    stepType: 'await_decision',
    owner: 'payer',
    triggerDaysAfterPrev: 1,
    isBlocking: true,
    estimatedDaysMin: 30,
    estimatedDaysMax: 90,
    actionType: 'payer_review',
  },
  {
    stepOrder: 6,
    name: 'Credentialing Committee Review',
    description: 'Committee reviews and issues written decision.',
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
    name: 'Network Effective Date Confirmed',
    description: 'Approval letter with effective date issued.',
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

// Conditions: model JSON's `condition: "panel_open"` and `condition: "approved"` as skip_step rows.
// Semantics: for each step that should only run on a specific outcome, create one skip_step row
// per "other" possible outcome from the preceding step. So med-03 ("panel_open" required from
// med-02 which has [panel_open, panel_closed]) gets ONE skip row: skip if previous_outcome == panel_closed.
// med-07 / bh-07 ("approved" required from a committee step with [approved, denied, additional_info_needed])
// get TWO skip rows each.
const MEDICAL_CONDITIONS: ConditionInput[] = [
  {
    conditionType: 'previous_outcome',
    conditionValue: 'panel_closed',
    action: 'skip_step',
    targetStepOrder: 3,
  },
  {
    conditionType: 'previous_outcome',
    conditionValue: 'denied',
    action: 'skip_step',
    targetStepOrder: 7,
  },
  {
    conditionType: 'previous_outcome',
    conditionValue: 'additional_info_needed',
    action: 'skip_step',
    targetStepOrder: 7,
  },
];

const BH_CONDITIONS: ConditionInput[] = [
  {
    conditionType: 'previous_outcome',
    conditionValue: 'denied',
    action: 'skip_step',
    targetStepOrder: 7,
  },
  {
    conditionType: 'previous_outcome',
    conditionValue: 'additional_info_needed',
    action: 'skip_step',
    targetStepOrder: 7,
  },
];

// ─── Seed function ──────────────────────────────────────────────────────────

export interface SeedResult {
  payerTracksCreated: number;
  payerTracksFound: number;
  workflowTemplatesCreated: number;
  workflowStepsCreated: number;
  conditionsCreated: number;
  enrollmentsRelinked: number;
}

export async function seedAetna(
  prisma: PrismaClient,
  opts: { dryRun?: boolean } = {}
): Promise<SeedResult> {
  const dryRun = opts.dryRun ?? false;

  const result: SeedResult = {
    payerTracksCreated: 0,
    payerTracksFound: 0,
    workflowTemplatesCreated: 0,
    workflowStepsCreated: 0,
    conditionsCreated: 0,
    enrollmentsRelinked: 0,
  };

  // 1. Find or create the two Aetna PayerTracks.
  const trackDefs = [
    {
      payerName: PAYER_NAME,
      track: MEDICAL_TRACK,
      stateRegion: STATE_REGION,
      payerType: 'Commercial',
      submissionMethod: 'web_form',
      enrollmentLink: 'https://www.aetna.com/health-care-professionals/join-the-aetna-network.html',
      portalUrl: 'https://availity.com',
      notes: 'CVS Health subsidiary. CVO: 3Won/ProVault (NCQA + URAC accredited). Re-credentialing: 36 months. CAQH attestation window: 120 days.',
    },
    {
      payerName: PAYER_NAME,
      track: BH_TRACK,
      stateRegion: STATE_REGION,
      payerType: 'Commercial',
      submissionMethod: 'web_form',
      enrollmentLink: 'https://www.aetna.com/health-care-professionals/forms/behavioral-health-application.html',
      portalUrl: 'https://availity.com',
      notes: 'Aetna frequently delegates BH credentialing to third parties (often Optum/UBH), adding complexity. BH providers MUST use the dedicated BH form. Aetna cut audio-only / asynchronous telehealth coverage in 2024 — live video only.',
    },
  ];

  const trackIds: Record<string, string> = {};
  for (const td of trackDefs) {
    const existing = await prisma.payerTrack.findUnique({
      where: {
        payerName_track_stateRegion: {
          payerName: td.payerName,
          track: td.track,
          stateRegion: td.stateRegion,
        },
      },
    });
    if (existing) {
      result.payerTracksFound++;
      trackIds[td.track] = existing.id;
    } else if (!dryRun) {
      const created = await prisma.payerTrack.create({ data: td });
      result.payerTracksCreated++;
      trackIds[td.track] = created.id;
    } else {
      trackIds[td.track] = `dry-run-${td.track}`;
    }
  }

  // 2. Find existing Aetna templates so we can null-out enrollment FKs before deleting.
  const existingTemplates = await prisma.workflowTemplate.findMany({
    where: { payerTrackId: { in: Object.values(trackIds).filter((id) => !id.startsWith('dry-run')) } },
    select: { id: true, name: true },
  });

  if (existingTemplates.length > 0 && !dryRun) {
    const templateIds = existingTemplates.map((t) => t.id);
    const relinked = await prisma.enrollment.updateMany({
      where: { workflowTemplateId: { in: templateIds } },
      data: { workflowTemplateId: null },
    });
    result.enrollmentsRelinked = relinked.count;

    // Cascade-deletes steps and conditions per schema relations.
    await prisma.workflowTemplate.deleteMany({
      where: { id: { in: templateIds } },
    });
  }

  // 3. Create templates + steps + conditions.
  const templateDefs = [
    {
      trackKey: MEDICAL_TRACK,
      name: 'Aetna Medical Provider Enrollment',
      description: 'Aetna medical-panel credentialing & enrollment workflow. Official timeline: 30–45 business days. Real-world: 90–120 calendar days.',
      steps: MEDICAL_STEPS,
      conditions: MEDICAL_CONDITIONS,
    },
    {
      trackKey: BH_TRACK,
      name: 'Aetna Behavioral Health Provider Enrollment',
      description: 'Aetna behavioral health credentialing & enrollment workflow. Official timeline: 30–45 business days. Real-world: 180–365 calendar days due to third-party delegation routing.',
      steps: BH_STEPS,
      conditions: BH_CONDITIONS,
    },
  ];

  for (const td of templateDefs) {
    if (dryRun) {
      console.log(`  [WORKFLOW] ${td.name}: ${td.steps.length} steps, ${td.conditions.length} conditions`);
      result.workflowTemplatesCreated++;
      result.workflowStepsCreated += td.steps.length;
      result.conditionsCreated += td.conditions.length;
      continue;
    }

    const now = new Date();
    const template = await prisma.workflowTemplate.create({
      data: {
        payerTrackId: trackIds[td.trackKey]!,
        name: td.name,
        version: 1,
        status: 'active',
        description: td.description,
        createdBy: SYSTEM_USER,
        publishedAt: now,
        updatedAt: now,
      },
    });
    result.workflowTemplatesCreated++;

    for (const step of td.steps) {
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

    for (const cond of td.conditions) {
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
    console.log(`\n🌱 Aetna workflow seed${DRY_RUN ? ' (dry-run)' : ''}\n`);
    const result = await seedAetna(prisma, { dryRun: DRY_RUN });
    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('  SUMMARY');
    console.log('═══════════════════════════════════════════════════════════');
    console.log(`  PayerTracks created:     ${result.payerTracksCreated}`);
    console.log(`  PayerTracks already present: ${result.payerTracksFound}`);
    console.log(`  WorkflowTemplates:       ${result.workflowTemplatesCreated}`);
    console.log(`  WorkflowTemplateSteps:   ${result.workflowStepsCreated}`);
    console.log(`  Conditions:              ${result.conditionsCreated}`);
    console.log(`  Enrollments re-linked:   ${result.enrollmentsRelinked}`);
    console.log('═══════════════════════════════════════════════════════════\n');
  } finally {
    await prisma.$disconnect();
  }
}

// Run when invoked directly via tsx; not when imported by a master seed runner.
const invokedDirectly = process.argv[1]?.endsWith('aetna.seed.ts') || process.argv[1]?.endsWith('aetna.seed.js');
if (invokedDirectly) {
  main().catch((err) => {
    console.error('Aetna seed failed:', err);
    process.exit(1);
  });
}
