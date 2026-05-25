/**
 * Cigna / Evernorth Workflow Seed — Phase 2 of payer-workflows.json → DB migration.
 *
 * Creates DB-backed WorkflowTemplate rows for:
 *   - Cigna Healthcare / Medical (5 steps)
 *   - Evernorth Behavioral Health × 3 tracks (Clinic, Facility, Individual) — same 7 BH steps each
 *
 * The JSON defines one "behavioral_health" workflow but the DB splits Evernorth BH into 3
 * provider-scale tracks. We create one WorkflowTemplate per track so the Path A resolver
 * always finds a template regardless of which BH track the enrollment lands on.
 *
 * Replaces the legacy Path B (JSON hydration) for Cigna only; remaining payers (UHC,
 * Optum, Humana) continue using Path B until their respective seeds ship.
 *
 * Notable Cigna-specific bits encoded here:
 *   - cigna-bh-01 CAQH authorization warning: BOTH 'Cigna Healthcare' AND 'Evernorth
 *     Behavioral Health' must be authorized. Authorizing only the parent will not cover BH.
 *   - cigna-bh-02 state exception: MD/OH/WA submit via email to BehavioralHCPEnrollment@
 *     Evernorth.com rather than the online form. Modeled as conditionType='state' /
 *     conditionValues=['MD','OH','WA'] / action='modify_step' with the alternate
 *     submission method in stepDefinition JSON.
 *   - cigna-bh-05 discrepancy_process (5-day notification window, 30-day response window,
 *     3-clinician appeal panel) stored in the step's metadata field.
 *
 * Idempotency: re-runs are safe. Same dance as Aetna seed:
 *   1. Find existing Cigna + Evernorth PayerTracks by payerName.
 *   2. Null out enrollment.workflowTemplateId on enrollments referencing the current
 *      templates so deleteMany doesn't fail with FK violation.
 *   3. Delete existing templates (cascade-deletes steps + conditions).
 *   4. Re-create templates + steps + conditions fresh.
 *
 * Usage:
 *   npx tsx packages/backend/prisma/seeds/payerWorkflows/cigna.seed.ts
 *   npx tsx packages/backend/prisma/seeds/payerWorkflows/cigna.seed.ts --dry-run
 */

import { PrismaClient, Prisma } from '@prisma/client';

const DRY_RUN = process.argv.includes('--dry-run');
const SYSTEM_USER = 'system-seed';

const CIGNA_PAYER_NAME = 'Cigna Healthcare';
const EVERNORTH_PAYER_NAME = 'Evernorth Behavioral Health';
const STATE_REGION = 'Nationwide';

// Track names MUST match the existing PayerTrack rows created upstream (knowledgeBase seed
// or payer-adapter seed). Confirmed via:
//   SELECT payer_name, track FROM payer_tracks WHERE payer_name ILIKE 'cigna%' OR payer_name ILIKE '%evernorth%';
const MEDICAL_TRACK = 'Medical';
const BH_TRACKS = [
  'Behavioral Health — Clinic',
  'Behavioral Health — Facility',
  'Behavioral Health — Individual',
] as const;

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

// Cigna Medical — 5 steps, sourced from payer-workflows.json lines 463–517.
const MEDICAL_STEPS: StepInput[] = [
  {
    stepOrder: 1,
    name: 'Call Cigna Credentialing Line',
    description:
      'Call 1-800-882-4462 and select the credentialing option. A representative confirms eligibility and emails the application packet.',
    stepType: 'submit_application',
    owner: 'provider',
    triggerDaysAfterPrev: null,
    isBlocking: true,
    estimatedDaysMin: 1,
    estimatedDaysMax: 1,
    actionType: 'phone_call',
    metadata: { contact: '1-800-882-4462' },
  },
  {
    stepOrder: 2,
    name: 'Complete & Submit Application Packet',
    description:
      'Fill out the application packet received via email and submit it back to Cigna with the required supporting documents.',
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
    estimatedDaysMin: 3,
    estimatedDaysMax: 7,
    actionType: 'form_submission',
  },
  {
    stepOrder: 3,
    name: 'Primary Source Verification',
    description: 'Cigna credentialing team verifies all documentation through primary sources.',
    stepType: 'await_decision',
    owner: 'payer',
    triggerDaysAfterPrev: 1,
    isBlocking: true,
    estimatedDaysMin: 30,
    estimatedDaysMax: 45,
    actionType: 'payer_review',
  },
  {
    stepOrder: 4,
    name: 'Credentialing Committee Review',
    description:
      'Committee composed of community physicians and the health plan medical director reviews the file.',
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
    stepOrder: 5,
    name: 'Welcome Letter & Directory Listing',
    description:
      'Welcome letter issued. Provider directory updated within 10 business days of approval.',
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

// Evernorth Behavioral Health — 7 steps, sourced from payer-workflows.json lines 532–612.
const BH_STEPS: StepInput[] = [
  {
    stepOrder: 1,
    name: 'Authorize Evernorth in CAQH',
    description:
      "In CAQH ProView, authorize BOTH 'Cigna Healthcare' AND 'Evernorth Behavioral Health' for data sharing. This is the #1 missed step.",
    stepType: 'submit_application',
    owner: 'provider',
    triggerDaysAfterPrev: null,
    isBlocking: true,
    estimatedDaysMin: 1,
    estimatedDaysMax: 1,
    warnings: [
      "Must authorize BOTH entities. Authorizing only 'Cigna Healthcare' will NOT cover BH.",
    ],
    actionType: 'caqh_update',
  },
  {
    stepOrder: 2,
    name: 'Submit Evernorth BH Provider Information Form',
    description:
      "Complete the online form at Evernorth's Salesforce portal. Exception: MD, OH, WA providers email BehavioralHCPEnrollment@Evernorth.com instead of using the online form.",
    stepType: 'submit_application',
    owner: 'provider',
    triggerDaysAfterPrev: 1,
    isBlocking: true,
    url: 'https://cignathn.my.salesforce-sites.com/cbus',
    estimatedDaysMin: 1,
    estimatedDaysMax: 1,
    actionType: 'form_submission',
    metadata: {
      state_exceptions: {
        states: ['MD', 'OH', 'WA'],
        method: 'email',
        email: 'BehavioralHCPEnrollment@Evernorth.com',
        response_time_business_days: 15,
      },
    },
  },
  {
    stepOrder: 3,
    name: 'Evernorth Initial Outreach',
    description:
      'Evernorth contacts the provider within 21 business days with next steps or information requests.',
    stepType: 'await_decision',
    owner: 'payer',
    triggerDaysAfterPrev: 1,
    isBlocking: true,
    estimatedDaysMin: 21,
    estimatedDaysMax: 21,
    warnings: [
      'If Evernorth requests additional information, providers have 30 days to respond or the application may be closed.',
    ],
    actionType: 'payer_outreach',
  },
  {
    stepOrder: 4,
    name: 'Sign Contract via DocuSign',
    description:
      'Evernorth sends Individual Agreement via DocuSign for electronic signature. Multiple network types available: Open Access Plus, LocalPlus, PPO, HMO, EAP.',
    stepType: 'submit_application',
    owner: 'provider',
    triggerDaysAfterPrev: 1,
    isBlocking: true,
    estimatedDaysMin: 1,
    estimatedDaysMax: 5,
    actionType: 'contract_execution',
    metadata: {
      method: 'DocuSign',
      networks: ['Open Access Plus', 'LocalPlus', 'PPO', 'HMO', 'EAP'],
    },
  },
  {
    stepOrder: 5,
    name: 'Primary Source Verification',
    description:
      'Evernorth Credentialing Committee conducts verification. If significant discrepancies are found, the provider is contacted within 5 days with 30 days to respond.',
    stepType: 'await_decision',
    owner: 'payer',
    triggerDaysAfterPrev: 1,
    isBlocking: true,
    estimatedDaysMin: 30,
    estimatedDaysMax: 60,
    actionType: 'payer_review',
    metadata: {
      discrepancy_process: {
        notification_days: 5,
        response_window_days: 30,
        appeal_available: true,
        appeal_panel_size: 3,
      },
    },
  },
  {
    stepOrder: 6,
    name: 'Credentialing Committee Decision',
    description:
      'Evernorth Credentialing Committee approves or denies. Appeal process available through a separate panel of 3+ uninvolved clinicians.',
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
    name: 'Welcome Letter & Directory Upload',
    description:
      'Welcome letter issued. Provider directory updated within 10 business days of approval.',
    stepType: 'record_outcome',
    owner: 'payer',
    triggerDaysAfterPrev: 1,
    isBlocking: true,
    estimatedDaysMin: 10,
    estimatedDaysMax: 10,
    actionType: 'confirmation',
    metadata: { condition: 'approved' },
  },
];

// Medical conditions: gate cigna-med-05 (welcome letter) on cigna-med-04 outcome == 'approved'.
// Modeled as skip rows for each non-approved outcome.
const MEDICAL_CONDITIONS: ConditionInput[] = [
  {
    conditionType: 'previous_outcome',
    conditionValue: 'denied',
    action: 'skip_step',
    targetStepOrder: 5,
  },
  {
    conditionType: 'previous_outcome',
    conditionValue: 'additional_info_needed',
    action: 'skip_step',
    targetStepOrder: 5,
  },
];

// BH conditions:
//   1. cigna-bh-02 state-exception: in MD/OH/WA, swap web form for email submission.
//   2. cigna-bh-07 gated on cigna-bh-06 outcome == 'approved' — skip rows per other outcome.
const BH_CONDITIONS: ConditionInput[] = [
  {
    conditionType: 'state',
    conditionValue: 'MD',
    conditionValues: ['MD', 'OH', 'WA'],
    action: 'modify_step',
    targetStepOrder: 2,
    stepDefinition: {
      submissionMethod: 'email',
      email: 'BehavioralHCPEnrollment@Evernorth.com',
      url: null,
      description:
        "In MD/OH/WA, the online Salesforce form is not used. Email the BH provider information packet to BehavioralHCPEnrollment@Evernorth.com. Evernorth responds within 15 business days.",
      response_time_business_days: 15,
    },
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

export async function seedCigna(
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

  // 1. Assemble the per-track template plans.
  const trackPlans: TrackPlan[] = [
    {
      payerName: CIGNA_PAYER_NAME,
      track: MEDICAL_TRACK,
      templateName: 'Cigna Medical Provider Enrollment',
      templateDescription:
        'Cigna medical-panel credentialing & enrollment workflow. Official timeline: 45–60 calendar days. Real-world: 60–90 calendar days. Re-credentialing every 36 months; CAQH attestation window 120 days.',
      steps: MEDICAL_STEPS,
      conditions: MEDICAL_CONDITIONS,
    },
    ...BH_TRACKS.map((track) => ({
      payerName: EVERNORTH_PAYER_NAME,
      track,
      templateName: `Cigna / Evernorth Behavioral Health Enrollment (${track.replace('Behavioral Health — ', '')})`,
      templateDescription:
        'Evernorth Behavioral Health credentialing & enrollment workflow. Official timeline: 21–90 business days. Real-world: 60–120 calendar days. CAQH must authorize BOTH "Cigna Healthcare" and "Evernorth Behavioral Health". Exception states (MD/OH/WA) submit via email instead of the online form. BH providers must maintain 24 clinical hours per week.',
      steps: BH_STEPS,
      conditions: BH_CONDITIONS,
    })),
  ];

  // 2. Resolve PayerTrack IDs. We require the track to already exist — knowledge base
  //    seed owns track creation; this seed never invents new tracks.
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
      `Cigna seed cannot proceed — missing PayerTrack rows: ${result.payerTracksMissing.join('; ')}. Run the knowledge base seed first.`
    );
  }

  // 3. Null out enrollment FKs and delete existing templates for these tracks before re-creating.
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

  // 4. Create templates + steps + conditions.
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

    if (!trackId) {
      // Shouldn't happen — we threw above if any were missing.
      continue;
    }

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
    console.log(`\n🌱 Cigna / Evernorth workflow seed${DRY_RUN ? ' (dry-run)' : ''}\n`);
    const result = await seedCigna(prisma, { dryRun: DRY_RUN });
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
  process.argv[1]?.endsWith('cigna.seed.ts') || process.argv[1]?.endsWith('cigna.seed.js');
if (invokedDirectly) {
  main().catch((err) => {
    console.error('Cigna seed failed:', err);
    process.exit(1);
  });
}
