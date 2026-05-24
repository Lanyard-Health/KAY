/**
 * Humana Workflow Seed — Phase 5 of payer-workflows.json → DB migration.
 *
 * Last per-payer migration. Creates 2 WorkflowTemplate rows (Humana Medical +
 * Humana Behavioral Health). The DB also has a "Humana / Dental" PayerTrack but
 * the JSON has no Dental workflow definition; Dental keeps its auto-generated
 * 10-step generic template.
 *
 * Humana is the most operationally complex of the 5 payers:
 *   - Submission method varies by state. 7 states (IN/KY/MI/OH/OK/VA/WV for
 *     medical, IN/MI/OH/OK/VA/WV for BH) use the Humana Quickbase portal.
 *     All other states submit a Letter of Interest (medical) or use a
 *     Microsoft Forms BH Provider Inquiry (BH).
 *   - Medical step 6 (on-site evaluation) only fires for PCP and OB-GYN
 *     providers — unique to Humana among the 5 payers studied.
 *   - For Medicaid in FL/IL, Humana partners with Carelon Behavioral Health
 *     rather than running BH directly. Preserved as a note on the BH template
 *     description so staff see it on enrollment.
 *   - Medicare PTAN is required for MA participation and missing PTAN is the
 *     #1 cause of MA denials at Humana. Encoded as a required_document on
 *     med-02 and bh-02 and as a warning on the workflow descriptions.
 *
 * Conditions modeled:
 *   - Medical state routing: `state` condition with conditionValues =
 *     [IN, KY, MI, OH, OK, VA, WV], action='modify_step', targetStepOrder=2,
 *     stepDefinition describing the Quickbase submission path. Default
 *     (non-Quickbase states) uses the Letter-of-Interest description in
 *     the step itself.
 *   - Medical site-visit conditional: `provider_type` condition with
 *     conditionValues=[PCP, OB-GYN], action='add_step', targetStepOrder=6.
 *     Step is marked isBlocking=false so non-PCP/OB-GYN providers don't
 *     block on it.
 *   - Medical committee outcome gate: skip rows for denied /
 *     additional_info_needed targeting med-08 so non-approved decisions
 *     don't progress through network activation.
 *   - BH state routing: same pattern as medical but with the slightly
 *     different state list (no KY) and Microsoft Forms as the alternate.
 *   - BH committee outcome gate: skip rows targeting bh-07.
 *
 * Idempotency: same dance as prior seeds — null out enrollment FKs, delete
 * existing Humana templates, recreate.
 *
 * Usage:
 *   npx tsx packages/backend/prisma/seeds/payerWorkflows/humana.seed.ts
 *   npx tsx packages/backend/prisma/seeds/payerWorkflows/humana.seed.ts --dry-run
 */

import { PrismaClient, Prisma } from '@prisma/client';

const DRY_RUN = process.argv.includes('--dry-run');
const SYSTEM_USER = 'system-seed';

const PAYER_NAME = 'Humana';
const STATE_REGION = 'Nationwide';
const MEDICAL_TRACK = 'Medical';
const BH_TRACK = 'Behavioral Health';

const QUICKBASE_URL = 'https://humana-6853.quickbase.com';
const MEDICAL_QUICKBASE_STATES = ['IN', 'KY', 'MI', 'OH', 'OK', 'VA', 'WV'];
const BH_QUICKBASE_STATES = ['IN', 'MI', 'OH', 'OK', 'VA', 'WV'];
const SITE_VISIT_PROVIDER_TYPES = ['PCP', 'OB-GYN'];

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

// Humana Medical — 8 steps, sourced from payer-workflows.json lines 291–373.
const MEDICAL_STEPS: StepInput[] = [
  {
    stepOrder: 1,
    name: 'Determine Submission Method by State',
    description:
      'Submission method depends on state. IN/KY/MI/OH/OK/VA/WV use the Humana Quickbase online form. All other states submit a Letter of Interest to their regional Humana representative.',
    stepType: 'submit_application',
    owner: 'provider',
    triggerDaysAfterPrev: null,
    isBlocking: true,
    estimatedDaysMin: 1,
    estimatedDaysMax: 1,
    actionType: 'routing_decision',
    metadata: {
      routing_rules: {
        quickbase_states: MEDICAL_QUICKBASE_STATES,
        quickbase_url: QUICKBASE_URL,
        other_states_method: 'Letter of Interest to regional rep',
      },
    },
  },
  {
    stepOrder: 2,
    name: 'Submit Interest / Application',
    description:
      'Submit via Letter of Interest to the regional Humana representative. (State-routing condition substitutes the Quickbase form for providers in IN/KY/MI/OH/OK/VA/WV.)',
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
      'doc-ptan',
    ],
    triggerDaysAfterPrev: 1,
    isBlocking: true,
    estimatedDaysMin: 1,
    estimatedDaysMax: 3,
    actionType: 'form_submission',
    warnings: [
      'Medicare PTAN is required for MA participation. Missing PTAN is the #1 cause of Medicare Advantage denials at Humana.',
    ],
  },
  {
    stepOrder: 3,
    name: 'Assigned Physician Contracting Representative',
    description:
      'Humana validates the request, assigns a contracting representative with a tracking number, and sends a follow-up email with contracting documents.',
    stepType: 'await_decision',
    owner: 'payer',
    triggerDaysAfterPrev: 1,
    isBlocking: true,
    estimatedDaysMin: 7,
    estimatedDaysMax: 21,
    actionType: 'payer_outreach',
  },
  {
    stepOrder: 4,
    name: 'Sign Contracting Documents',
    description: 'Review and sign the participation agreement sent via email.',
    stepType: 'submit_application',
    owner: 'provider',
    triggerDaysAfterPrev: 1,
    isBlocking: true,
    estimatedDaysMin: 3,
    estimatedDaysMax: 7,
    actionType: 'contract_execution',
  },
  {
    stepOrder: 5,
    name: 'Primary Source Verification',
    description:
      'Humana credentialing team verifies documentation, runs NPDB, OIG/SAM, and Medicare sanctions checks.',
    stepType: 'await_decision',
    owner: 'payer',
    triggerDaysAfterPrev: 1,
    isBlocking: true,
    estimatedDaysMin: 30,
    estimatedDaysMax: 45,
    actionType: 'payer_review',
    metadata: {
      verification_items: ['NPDB', 'OIG_SAM', 'Medicare_sanctions'],
    },
  },
  {
    stepOrder: 6,
    name: 'Provider Office Site Evaluation',
    description:
      'Humana conducts an on-site evaluation. Required only for PCP and OB-GYN locations — unique to Humana among the five payers studied. Non-PCP / non-OB-GYN providers skip this step.',
    stepType: 'await_decision',
    owner: 'payer',
    triggerDaysAfterPrev: 1,
    // Non-blocking because most provider types skip this step entirely via the
    // provider_type condition below.
    isBlocking: false,
    estimatedDaysMin: 7,
    estimatedDaysMax: 30,
    actionType: 'site_visit',
    metadata: {
      required_for: SITE_VISIT_PROVIDER_TYPES,
      conditional: true,
      note: 'Step is only active for provider_type in [PCP, OB-GYN]; see WorkflowTemplateCondition for the provider_type gate.',
    },
  },
  {
    stepOrder: 7,
    name: 'Credentialing Committee Decision',
    description:
      'Committee reviews and communicates decision within 60 business days of the committee meeting.',
    stepType: 'await_decision',
    owner: 'payer',
    triggerDaysAfterPrev: 1,
    isBlocking: true,
    estimatedDaysMin: 60,
    estimatedDaysMax: 60,
    possibleOutcomes: ['approved', 'denied', 'additional_info_needed'],
    actionType: 'committee_review',
  },
  {
    stepOrder: 8,
    name: 'Network Effective Date + System Updates',
    description:
      'Network effective date is set 30 days after all CAQH documentation is received, with another 30 days for system updates.',
    stepType: 'record_outcome',
    owner: 'payer',
    triggerDaysAfterPrev: 1,
    isBlocking: true,
    estimatedDaysMin: 30,
    estimatedDaysMax: 60,
    warnings: [
      '30 days after CAQH complete + 30 days system updates = up to 60 days post-approval before truly live.',
    ],
    actionType: 'confirmation',
    metadata: { condition: 'approved' },
  },
];

// Humana BH — 7 steps, sourced from payer-workflows.json lines 388–458.
const BH_STEPS: StepInput[] = [
  {
    stepOrder: 1,
    name: 'Determine Submission Method by State',
    description:
      'Submission method depends on state. IN/MI/OH/OK/VA/WV use the Humana Quickbase online form. All other states use the Behavioral Health Provider Inquiry form (Microsoft Forms).',
    stepType: 'submit_application',
    owner: 'provider',
    triggerDaysAfterPrev: null,
    isBlocking: true,
    estimatedDaysMin: 1,
    estimatedDaysMax: 1,
    actionType: 'routing_decision',
    metadata: {
      routing_rules: {
        quickbase_states: BH_QUICKBASE_STATES,
        quickbase_url: QUICKBASE_URL,
        other_states_method: 'Microsoft Forms (BH Provider Inquiry)',
        other_states_url: 'https://forms.office.com',
      },
    },
  },
  {
    stepOrder: 2,
    name: 'Submit BH Application',
    description:
      'Submit via the Behavioral Health Provider Inquiry Microsoft Forms by default. Include the Behavioral Health Profiling Form. (State-routing condition substitutes the Quickbase form for providers in IN/MI/OH/OK/VA/WV.)',
    stepType: 'submit_application',
    owner: 'provider',
    requiredDocuments: [
      'doc-npi',
      'doc-license',
      'doc-malpractice',
      'doc-w9',
      'doc-cv',
      'doc-caqh',
      'doc-ptan',
      'doc-bh-profiling',
    ],
    triggerDaysAfterPrev: 1,
    isBlocking: true,
    estimatedDaysMin: 1,
    estimatedDaysMax: 3,
    actionType: 'form_submission',
    warnings: [
      'Medicare PTAN is required for MA participation. Missing PTAN is the #1 cause of Medicare Advantage denials at Humana.',
      'BH Profiling Form is required in addition to standard documents.',
    ],
  },
  {
    stepOrder: 3,
    name: 'Contracting Representative Assignment',
    description: 'Humana validates the request and assigns a contracting representative.',
    stepType: 'await_decision',
    owner: 'payer',
    triggerDaysAfterPrev: 1,
    isBlocking: true,
    estimatedDaysMin: 7,
    estimatedDaysMax: 21,
    actionType: 'payer_outreach',
  },
  {
    stepOrder: 4,
    name: 'Sign BH Participation Agreement',
    description: 'Review and sign the behavioral health participation agreement.',
    stepType: 'submit_application',
    owner: 'provider',
    triggerDaysAfterPrev: 1,
    isBlocking: true,
    estimatedDaysMin: 3,
    estimatedDaysMax: 7,
    actionType: 'contract_execution',
  },
  {
    stepOrder: 5,
    name: 'Primary Source Verification',
    description: 'Full credentialing verification including Medicare sanctions review.',
    stepType: 'await_decision',
    owner: 'payer',
    triggerDaysAfterPrev: 1,
    isBlocking: true,
    estimatedDaysMin: 20,
    estimatedDaysMax: 40,
    actionType: 'payer_review',
    metadata: {
      verification_items: ['licensure', 'NPDB', 'OIG_SAM', 'Medicare_sanctions'],
    },
  },
  {
    stepOrder: 6,
    name: 'Credentialing Committee Decision',
    description: 'Committee reviews and communicates decision.',
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
    name: 'Network Activation + System Updates',
    description:
      'Network effective date confirmed. 30 days after CAQH complete + 30 days for system updates.',
    stepType: 'record_outcome',
    owner: 'payer',
    triggerDaysAfterPrev: 1,
    isBlocking: true,
    estimatedDaysMin: 30,
    estimatedDaysMax: 60,
    actionType: 'confirmation',
    metadata: { condition: 'approved' },
  },
];

// Medical conditions: state routing + PCP/OB-GYN site-visit gate + committee outcome gates.
const MEDICAL_CONDITIONS: ConditionInput[] = [
  // 1. State routing: replace step-2 (Letter of Interest) with Quickbase submission for the 7 Quickbase states.
  {
    conditionType: 'state',
    conditionValue: 'IN',
    conditionValues: MEDICAL_QUICKBASE_STATES,
    action: 'modify_step',
    targetStepOrder: 2,
    stepDefinition: {
      submissionMethod: 'web_form',
      url: QUICKBASE_URL,
      description:
        'In IN/KY/MI/OH/OK/VA/WV, submit via the Humana Quickbase online form instead of a Letter of Interest.',
    },
  },
  // 2. Site visit only for PCP / OB-GYN providers.
  {
    conditionType: 'provider_type',
    conditionValue: 'PCP',
    conditionValues: SITE_VISIT_PROVIDER_TYPES,
    action: 'add_step',
    targetStepOrder: 6,
    stepDefinition: {
      note: 'Activate provider office site evaluation for PCP and OB-GYN providers. Non-matching provider types skip this step.',
    },
  },
  // 3. Committee outcome gates: skip network activation on non-approved decisions.
  { conditionType: 'previous_outcome', conditionValue: 'denied', action: 'skip_step', targetStepOrder: 8 },
  { conditionType: 'previous_outcome', conditionValue: 'additional_info_needed', action: 'skip_step', targetStepOrder: 8 },
];

// BH conditions: state routing + committee outcome gates.
const BH_CONDITIONS: ConditionInput[] = [
  // 1. State routing: replace step-2 (Microsoft Forms) with Quickbase for the 6 Quickbase states.
  {
    conditionType: 'state',
    conditionValue: 'IN',
    conditionValues: BH_QUICKBASE_STATES,
    action: 'modify_step',
    targetStepOrder: 2,
    stepDefinition: {
      submissionMethod: 'web_form',
      url: QUICKBASE_URL,
      description:
        'In IN/MI/OH/OK/VA/WV, submit via the Humana Quickbase online form instead of the Microsoft Forms BH Provider Inquiry.',
    },
  },
  // 2. Committee outcome gates: skip network activation on non-approved decisions.
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

export async function seedHumana(
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
      templateName: 'Humana Medical Provider Enrollment',
      templateDescription:
        'Humana medical-panel credentialing & enrollment workflow. Official timeline: 45–90 calendar days. Real-world: 90–150 calendar days. Re-credentialing every 36 months; CAQH attestation window 180 days. Submission method varies by state — IN/KY/MI/OH/OK/VA/WV submit via the Humana Quickbase portal (https://humana-6853.quickbase.com); all other states submit a Letter of Interest to a regional representative. PCP and OB-GYN locations require an on-site evaluation (unique to Humana). Medicare PTAN is required for MA participation — missing PTAN is the #1 cause of MA denials at Humana.',
      steps: MEDICAL_STEPS,
      conditions: MEDICAL_CONDITIONS,
    },
    {
      payerName: PAYER_NAME,
      track: BH_TRACK,
      templateName: 'Humana Behavioral Health Provider Enrollment',
      templateDescription:
        'Humana behavioral health credentialing & enrollment workflow. Official timeline: 45–90 calendar days. Real-world: 60–90 calendar days. Humana operates its own BH network through Humana Behavioral Health. For Medicaid in FL and IL, Humana partners with Carelon Behavioral Health rather than running BH directly — providers in those states for Medicaid products may be routed through Carelon. The BH Profiling Form is required in addition to standard documents. Submission method varies by state: IN/MI/OH/OK/VA/WV use the Humana Quickbase portal; all other states use the Microsoft Forms BH Provider Inquiry. Telehealth: audio-only permanently allowed, no geographic restrictions, in-person waived through 12/31/2027.',
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
      `Humana seed cannot proceed — missing PayerTrack rows: ${result.payerTracksMissing.join('; ')}. Run the knowledge base seed first.`
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
    console.log(`\n🌱 Humana workflow seed${DRY_RUN ? ' (dry-run)' : ''}\n`);
    const result = await seedHumana(prisma, { dryRun: DRY_RUN });
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
  process.argv[1]?.endsWith('humana.seed.ts') || process.argv[1]?.endsWith('humana.seed.js');
if (invokedDirectly) {
  main().catch((err) => {
    console.error('Humana seed failed:', err);
    process.exit(1);
  });
}
