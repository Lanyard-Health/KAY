/**
 * Workflow & Follow-Up Template Seed Script
 *
 * Reads existing knowledge base data (payer_tracks, payer_contacts, payer_timelines,
 * payer_forms, payer_requirements) and generates:
 *   - WorkflowTemplate + WorkflowTemplateStep records for each PayerTrack
 *   - FollowUpTemplate + FollowUpTemplateStep records for PayerTracks that have contacts
 *
 * Idempotent — deletes existing templates and recreates them.
 * Does NOT touch knowledge base tables.
 * Does NOT call any embedding APIs.
 *
 * Usage:
 *   npx tsx prisma/seeds/workflowTemplates.seed.ts
 *   npx tsx prisma/seeds/workflowTemplates.seed.ts --dry-run
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const DRY_RUN = process.argv.includes('--dry-run');
const SYSTEM_USER = 'system-seed';

// ─── Helpers ────────────────────────────────────────────────────────────────

function cuid(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).substring(2, 10);
  return `c${ts}${rand}`;
}

// ─── Types ──────────────────────────────────────────────────────────────────

interface PayerTrackRow {
  id: string;
  payerName: string;
  track: string;
  stateRegion: string;
  submissionMethod: string;
  enrollmentLink: string | null;
  portalUrl: string | null;
}

interface ContactRow {
  payerTrackId: string;
  contactType: string;
  phone: string | null;
  email: string | null;
  fax: string | null;
  portalUrl: string | null;
}

interface TimelineRow {
  payerTrackId: string;
  processType: string;
  minDays: number | null;
  maxDays: number | null;
  notes: string | null;
}

interface FormRow {
  payerTrackId: string;
  formName: string;
  format: string;
  url: string | null;
}

interface RequirementRow {
  payerTrackId: string;
  name: string;
  overrideType: string;
  rule: string;
  isBlocking: boolean;
}

// ─── Load KB Data ───────────────────────────────────────────────────────────

async function loadKnowledgeBase() {
  const tracks = await prisma.payerTrack.findMany({
    orderBy: [{ payerName: 'asc' }, { track: 'asc' }],
  });

  const contacts = await prisma.payerContact.findMany();
  const timelines = await prisma.payerTimeline.findMany();
  const forms = await prisma.payerForm.findMany();
  const requirements = await prisma.payerRequirement.findMany();

  // Index by payerTrackId
  const contactsByTrack = new Map<string, ContactRow[]>();
  for (const c of contacts) {
    const arr = contactsByTrack.get(c.payerTrackId) || [];
    arr.push(c);
    contactsByTrack.set(c.payerTrackId, arr);
  }

  const timelinesByTrack = new Map<string, TimelineRow[]>();
  for (const t of timelines) {
    const arr = timelinesByTrack.get(t.payerTrackId) || [];
    arr.push(t);
    timelinesByTrack.set(t.payerTrackId, arr);
  }

  const formsByTrack = new Map<string, FormRow[]>();
  for (const f of forms) {
    const arr = formsByTrack.get(f.payerTrackId) || [];
    arr.push(f);
    formsByTrack.set(f.payerTrackId, arr);
  }

  const requirementsByTrack = new Map<string, RequirementRow[]>();
  for (const r of requirements) {
    const arr = requirementsByTrack.get(r.payerTrackId) || [];
    arr.push(r);
    requirementsByTrack.set(r.payerTrackId, arr);
  }

  return { tracks, contactsByTrack, timelinesByTrack, formsByTrack, requirementsByTrack };
}

// ─── Workflow Template Builder ──────────────────────────────────────────────

interface StepDef {
  stepOrder: number;
  name: string;
  description: string;
  stepType: string;
  owner: string;
  requiredDocuments: string[];
  triggerDaysAfterPrev: number | null;
  isBlocking: boolean;
  reviewerInstructions: string | null;
}

function buildWorkflowSteps(
  track: PayerTrackRow,
  forms: FormRow[],
  requirements: RequirementRow[],
  timeline: TimelineRow | null
): StepDef[] {
  const steps: StepDef[] = [];
  let order = 1;

  // ── Step 1: Readiness Check ──
  // Collect all blocking requirements for this payer
  const blockingReqs = requirements.filter((r) => r.isBlocking);
  const reqDocs = blockingReqs.map((r) => r.name);

  steps.push({
    stepOrder: order++,
    name: 'Provider Readiness Check',
    description: `Verify provider credentials meet ${track.payerName} requirements before starting enrollment.`,
    stepType: 'readiness_check',
    owner: 'credentialing_staff',
    requiredDocuments: [
      'Active state license',
      'NPI verification',
      'Malpractice insurance (current COI)',
      ...reqDocs,
    ],
    triggerDaysAfterPrev: null,
    isBlocking: true,
    reviewerInstructions: blockingReqs.length > 0
      ? `Payer-specific blocking requirements: ${blockingReqs.map((r) => `${r.name} — ${r.rule}`).join('; ')}`
      : null,
  });

  // ── Step 2: CAQH Authorization ──
  // Most payers use CAQH — include unless submission method suggests otherwise
  const usesCaqh = !['Email (PDF)', 'Paper / Portal', 'Email'].includes(track.submissionMethod);
  if (usesCaqh) {
    steps.push({
      stepOrder: order++,
      name: 'Authorize CAQH Data Sharing',
      description: `Grant ${track.payerName} access to CAQH ProView profile. Verify attestation is current.`,
      stepType: 'caqh_authorization',
      owner: 'provider',
      requiredDocuments: ['CAQH ProView attestation (within 120 days)'],
      triggerDaysAfterPrev: 1,
      isBlocking: true,
      reviewerInstructions: null,
    });
  }

  // ── Step 3: Collect & Prepare Documents ──
  const formDocs = forms.map((f) => `${f.formName} (${f.format})`);
  if (formDocs.length > 0 || forms.length > 0) {
    steps.push({
      stepOrder: order++,
      name: 'Collect Payer-Specific Documents',
      description: `Gather and prepare all required forms and documents for ${track.payerName} ${track.track} enrollment.`,
      stepType: 'populate_template',
      owner: 'credentialing_staff',
      requiredDocuments: formDocs.length > 0 ? formDocs : ['Standard credentialing packet'],
      triggerDaysAfterPrev: 2,
      isBlocking: true,
      reviewerInstructions: forms.some((f) => f.url)
        ? `Form links: ${forms.filter((f) => f.url).map((f) => `${f.formName}: ${f.url}`).join('; ')}`
        : null,
    });
  }

  // ── Step 4: Internal Review ──
  steps.push({
    stepOrder: order++,
    name: 'Internal Application Review',
    description: 'Review completed application packet for accuracy and completeness before submission.',
    stepType: 'human_review',
    owner: 'credentialing_staff',
    requiredDocuments: [],
    triggerDaysAfterPrev: 1,
    isBlocking: true,
    reviewerInstructions: 'Verify all fields are populated, signatures are present, and documents are legible. Cross-check NPI, license numbers, and dates against source records.',
  });

  // ── Step 5: Submit Application ──
  const submissionDesc = buildSubmissionDescription(track);
  steps.push({
    stepOrder: order++,
    name: `Submit Application via ${track.submissionMethod}`,
    description: submissionDesc,
    stepType: 'submit_application',
    owner: 'credentialing_staff',
    requiredDocuments: [],
    triggerDaysAfterPrev: 1,
    isBlocking: true,
    reviewerInstructions: track.enrollmentLink
      ? `Enrollment portal: ${track.enrollmentLink}`
      : track.portalUrl
        ? `Provider portal: ${track.portalUrl}`
        : null,
  });

  // ── Step 6: Confirm Submission Receipt ──
  steps.push({
    stepOrder: order++,
    name: 'Confirm Submission Receipt',
    description: `Verify ${track.payerName} received the application. Obtain reference/tracking number if available.`,
    stepType: 'confirm_submission',
    owner: 'credentialing_staff',
    requiredDocuments: [],
    triggerDaysAfterPrev: 3,
    isBlocking: true,
    reviewerInstructions: 'Check portal for submission confirmation or call payer to verify receipt. Record any reference numbers in enrollment notes.',
  });

  // ── Step 7: Follow-Up / Status Checks ──
  const followUpDays = timeline?.minDays ? Math.min(Math.round(timeline.minDays / 3), 14) : 14;
  steps.push({
    stepOrder: order++,
    name: 'Initial Follow-Up Status Check',
    description: `Contact ${track.payerName} to verify application is in review and no additional information is needed.`,
    stepType: 'follow_up',
    owner: 'credentialing_staff',
    requiredDocuments: [],
    triggerDaysAfterPrev: followUpDays,
    isBlocking: false,
    reviewerInstructions: timeline?.notes || null,
  });

  // ── Step 8: Escalation (if needed) ──
  const escalateDays = timeline?.maxDays
    ? Math.round((timeline.maxDays - (timeline.minDays || 0)) / 2)
    : 14;
  steps.push({
    stepOrder: order++,
    name: 'Escalation — No Response',
    description: `Escalate if no response from ${track.payerName} after initial follow-ups. Request supervisor review or file formal inquiry.`,
    stepType: 'escalate',
    owner: 'credentialing_staff',
    requiredDocuments: [],
    triggerDaysAfterPrev: Math.max(escalateDays, 7),
    isBlocking: false,
    reviewerInstructions: 'Escalate through payer\'s provider relations department. Document all contact attempts with dates and names.',
  });

  // ── Step 9: Await Payer Decision ──
  const awaitDays = timeline?.maxDays
    ? Math.max(timeline.maxDays - (timeline.minDays || 0), 14)
    : 30;
  steps.push({
    stepOrder: order++,
    name: 'Await Credentialing Decision',
    description: `${track.payerName} credentialing committee reviews application. Expected timeline: ${timeline ? `${timeline.minDays || '?'}–${timeline.maxDays || '?'} days` : 'varies'}.`,
    stepType: 'await_decision',
    owner: 'payer',
    requiredDocuments: [],
    triggerDaysAfterPrev: Math.max(awaitDays, 7),
    isBlocking: true,
    reviewerInstructions: timeline?.notes || null,
  });

  // ── Step 10: Record Outcome ──
  steps.push({
    stepOrder: order++,
    name: 'Record Credentialing Outcome',
    description: 'Record approval, denial, or request for additional information. Update enrollment status and effective date if approved.',
    stepType: 'record_outcome',
    owner: 'credentialing_staff',
    requiredDocuments: [],
    triggerDaysAfterPrev: 1,
    isBlocking: true,
    reviewerInstructions: 'If approved: record effective date, provider number, and network tier. If denied: capture reason code and initiate denial triage. If additional info requested: revert to document collection step.',
  });

  return steps;
}

function buildSubmissionDescription(track: PayerTrackRow): string {
  const method = track.submissionMethod;
  const payer = track.payerName;

  switch (method) {
    case 'Availity':
      return `Submit enrollment through Availity portal for ${payer}. Ensure all required attachments are uploaded.`;
    case 'Web Form':
    case 'Web Form / Portal':
    case 'Portal':
    case 'Portal Form':
      return `Complete and submit the online enrollment form on ${payer}'s provider portal.${track.enrollmentLink ? ` URL: ${track.enrollmentLink}` : ''}`;
    case 'Email (PDF)':
    case 'Email':
      return `Email completed PDF application packet to ${payer}'s credentialing department.`;
    case 'Paper / Portal':
      return `Submit application via ${payer}'s portal or mail paper application. Check portal for preferred method.`;
    case 'PECOS':
      return `Submit enrollment through PECOS (Provider Enrollment, Chain, and Ownership System) at pecos.cms.hhs.gov.`;
    case 'CAQH':
    case 'CAQH / e-onboarding':
      return `Initiate enrollment through CAQH ProView. ${payer} will pull application data directly from CAQH profile.`;
    default:
      return `Submit enrollment application to ${payer} using their required submission process.`;
  }
}

// ─── Follow-Up Template Builder ─────────────────────────────────────────────

interface FollowUpStepDef {
  stepOrder: number;
  name: string;
  channel: 'email' | 'phone_call';
  triggerDaysAfterPrev: number;
  escalationLevel: number;
  emailSubject: string | null;
  emailBodyTemplate: string | null;
  emailTone: string | null;
  retellScriptTemplate: string | null;
  requiresApproval: boolean;
}

function buildFollowUpSteps(
  track: PayerTrackRow,
  contacts: ContactRow[],
  timeline: TimelineRow | null
): FollowUpStepDef[] {
  const steps: FollowUpStepDef[] = [];

  // Determine contact channels available
  const hasEmail = contacts.some((c) => c.email);
  const hasPhone = contacts.some((c) => c.phone);
  const credEmail = contacts.find((c) => c.email && c.contactType.toLowerCase().includes('credential'))?.email
    || contacts.find((c) => c.email)?.email;
  const credPhone = contacts.find((c) => c.phone && c.contactType.toLowerCase().includes('credential'))?.phone
    || contacts.find((c) => c.phone)?.phone;

  // Base interval: if we have timeline data, first follow-up at ~1/3 of min days, else 14 days
  const baseInterval = timeline?.minDays ? Math.min(Math.round(timeline.minDays / 3), 21) : 14;

  // ── Step 1: Initial Status Check (email preferred) ──
  // Email at escalation level 1 auto-sends; phone always requires approval
  const step1Channel: 'email' | 'phone_call' = hasEmail ? 'email' : 'phone_call';
  steps.push({
    stepOrder: 1,
    name: 'Initial Status Inquiry',
    channel: step1Channel,
    triggerDaysAfterPrev: baseInterval,
    escalationLevel: 1,
    emailSubject: hasEmail
      ? `Enrollment Status Inquiry — {{provider_name}} / {{payer_name}}`
      : null,
    emailBodyTemplate: hasEmail
      ? `Dear ${track.payerName} Credentialing Team,\n\nI am writing to check the status of the enrollment application for {{provider_name}} (NPI: {{provider_npi}}) submitted on {{submission_date}}.\n\nReference #: {{reference_number}}\nTrack: ${track.track}\n\nCould you please confirm the current status and whether any additional information is needed?\n\nThank you,\n{{staff_name}}\n{{practice_name}}`
      : null,
    emailTone: 'professional',
    retellScriptTemplate: !hasEmail && hasPhone
      ? `Call ${track.payerName} credentialing at ${credPhone}. Inquire about enrollment status for {{provider_name}}, NPI {{provider_npi}}, submitted {{submission_date}}. Reference: {{reference_number}}. Ask if any documents or information are still needed.`
      : null,
    requiresApproval: step1Channel !== 'email',
  });

  // ── Step 2: Second Follow-Up (alternate channel or repeat) ──
  const step2Channel: 'email' | 'phone_call' = hasPhone ? 'phone_call' : 'email';
  steps.push({
    stepOrder: 2,
    name: 'Second Follow-Up',
    channel: step2Channel,
    triggerDaysAfterPrev: baseInterval,
    escalationLevel: 1,
    emailSubject: !hasPhone && hasEmail
      ? `Follow-Up: Enrollment Status — {{provider_name}} / {{payer_name}}`
      : null,
    emailBodyTemplate: !hasPhone && hasEmail
      ? `Dear ${track.payerName} Credentialing Team,\n\nThis is a follow-up to my previous inquiry regarding the enrollment application for {{provider_name}} (NPI: {{provider_npi}}).\n\nWe submitted the application on {{submission_date}} and have not yet received a status update. Could you please provide the current status?\n\nReference #: {{reference_number}}\n\nThank you,\n{{staff_name}}\n{{practice_name}}`
      : null,
    emailTone: 'professional',
    retellScriptTemplate: hasPhone
      ? `Call ${track.payerName} at ${credPhone}. This is a follow-up on enrollment for {{provider_name}}, NPI {{provider_npi}}. Application submitted {{submission_date}}, reference {{reference_number}}. Request timeline for decision and ask for the reviewer's direct contact information for future follow-ups.`
      : null,
    requiresApproval: step2Channel !== 'email',
  });

  // ── Step 3: Urgent Follow-Up (email, elevated tone) ──
  if (hasEmail) {
    steps.push({
      stepOrder: 3,
      name: 'Urgent Status Request',
      channel: 'email',
      triggerDaysAfterPrev: Math.round(baseInterval * 0.75),
      escalationLevel: 2,
      emailSubject: `URGENT: Enrollment Status Needed — {{provider_name}} / {{payer_name}}`,
      emailBodyTemplate: `Dear ${track.payerName} Credentialing Team,\n\nWe have been unable to obtain a status update on the enrollment application for {{provider_name}} (NPI: {{provider_npi}}), originally submitted on {{submission_date}}.\n\nThis application has been pending for {{days_elapsed}} days. We respectfully request an immediate update on the application status and expected timeline for a credentialing decision.\n\nReference #: {{reference_number}}\n\nPlease respond at your earliest convenience.\n\nRegards,\n{{staff_name}}\n{{practice_name}}`,
      emailTone: 'urgent',
      retellScriptTemplate: null,
      requiresApproval: true,
    });
  }

  // ── Step 4: Escalation Call ──
  if (hasPhone) {
    steps.push({
      stepOrder: hasEmail ? 4 : 3,
      name: 'Escalation — Supervisor Request',
      channel: 'phone_call',
      triggerDaysAfterPrev: Math.round(baseInterval * 0.5),
      escalationLevel: 3,
      emailSubject: null,
      emailBodyTemplate: null,
      emailTone: null,
      retellScriptTemplate: `Call ${track.payerName} at ${credPhone}. This is an escalation call for enrollment application for {{provider_name}}, NPI {{provider_npi}}, submitted {{submission_date}}. The application has been pending for {{days_elapsed}} days with no resolution. Request to speak with a supervisor or team lead. Ask for a firm timeline and the name of the person who will be handling the case going forward. Reference: {{reference_number}}.`,
      requiresApproval: true,
    });
  }

  // ── Step 5: Final Escalation (email to provider relations) ──
  steps.push({
    stepOrder: steps.length + 1,
    name: 'Final Escalation — Provider Relations',
    channel: 'email',
    triggerDaysAfterPrev: 7,
    escalationLevel: 4,
    emailSubject: `ESCALATION: Unresolved Enrollment — {{provider_name}} / {{payer_name}} ({{days_elapsed}} days)`,
    emailBodyTemplate: `To ${track.payerName} Provider Relations,\n\nDespite multiple follow-up attempts, we have been unable to resolve the enrollment application for {{provider_name}} (NPI: {{provider_npi}}), submitted on {{submission_date}}.\n\nThis application has been pending for {{days_elapsed}} days. All previous contact attempts through standard credentialing channels have not yielded a resolution.\n\nWe are requesting immediate escalation and a response within 5 business days.\n\nReference #: {{reference_number}}\nProvider: {{provider_name}}\nNPI: {{provider_npi}}\nTrack: ${track.track}\nState: ${track.stateRegion}\n\n{{staff_name}}\n{{practice_name}}`,
    emailTone: 'escalated',
    retellScriptTemplate: null,
    requiresApproval: true,
  });

  return steps;
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  LANYARD HEALTH — Workflow & Follow-Up Template Seed');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`  Dry run: ${DRY_RUN}`);
  console.log('');

  // Load all knowledge base data
  const { tracks, contactsByTrack, timelinesByTrack, formsByTrack, requirementsByTrack } =
    await loadKnowledgeBase();

  console.log(`  PayerTracks loaded: ${tracks.length}`);
  console.log('');

  if (!DRY_RUN) {
    // Clean existing templates (cascade deletes steps and conditions)
    console.log('🧹 Cleaning existing templates...');
    // Must delete runs first (FK to FollowUpTemplate)
    await prisma.followUpRun.deleteMany({});
    await prisma.followUpTemplateStep.deleteMany({});
    await prisma.followUpTemplate.deleteMany({});
    await prisma.workflowTemplateCondition.deleteMany({});
    await prisma.workflowTemplateStep.deleteMany({});
    await prisma.workflowTemplate.deleteMany({});
    console.log('  ✓ Cleaned\n');
  }

  let workflowCount = 0;
  let workflowStepCount = 0;
  let followUpCount = 0;
  let followUpStepCount = 0;

  for (const track of tracks) {
    const contacts = contactsByTrack.get(track.id) || [];
    const timelines = timelinesByTrack.get(track.id) || [];
    const forms = formsByTrack.get(track.id) || [];
    const requirements = requirementsByTrack.get(track.id) || [];

    // Pick the "Initial" timeline if available
    const initialTimeline = timelines.find((t) =>
      t.processType.toLowerCase().includes('initial')
    ) || timelines[0] || null;

    // ── Build Workflow Template ──
    const workflowSteps = buildWorkflowSteps(track, forms, requirements, initialTimeline);
    const templateName = `${track.payerName} — ${track.track} (${track.stateRegion})`;

    if (DRY_RUN) {
      console.log(`  [WORKFLOW] ${templateName}: ${workflowSteps.length} steps`);
    } else {
      const now = new Date();
      const template = await prisma.workflowTemplate.create({
        data: {
          payerTrackId: track.id,
          name: templateName,
          version: 1,
          status: 'active',
          description: `Enrollment workflow for ${track.payerName} ${track.track} in ${track.stateRegion}. Submission: ${track.submissionMethod}.`,
          createdBy: SYSTEM_USER,
          publishedAt: now,
          updatedAt: now,
        },
      });

      for (const step of workflowSteps) {
        await prisma.workflowTemplateStep.create({
          data: {
            templateId: template.id,
            ...step,
          },
        });
      }

      workflowStepCount += workflowSteps.length;
    }
    workflowCount++;

    // ── Build Follow-Up Template (only if contacts exist) ──
    if (contacts.length > 0) {
      const followUpSteps = buildFollowUpSteps(track, contacts, initialTimeline);

      if (DRY_RUN) {
        console.log(`  [FOLLOW-UP] ${templateName}: ${followUpSteps.length} steps`);
      } else {
        const now = new Date();
        const fuTemplate = await prisma.followUpTemplate.create({
          data: {
            payerTrackId: track.id,
            name: `Follow-Up: ${templateName}`,
            version: 1,
            status: 'active',
            description: `Follow-up sequence for ${track.payerName} ${track.track} enrollments. Channels: ${contacts.some((c) => c.email) ? 'email' : ''}${contacts.some((c) => c.email) && contacts.some((c) => c.phone) ? ' + ' : ''}${contacts.some((c) => c.phone) ? 'phone' : ''}.`,
            createdBy: SYSTEM_USER,
            publishedAt: now,
            updatedAt: now,
          },
        });

        for (const step of followUpSteps) {
          await prisma.followUpTemplateStep.create({
            data: {
              templateId: fuTemplate.id,
              ...step,
            },
          });
        }

        followUpStepCount += followUpSteps.length;
      }
      followUpCount++;
    }
  }

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('  SUMMARY');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`  Workflow Templates:      ${workflowCount}`);
  console.log(`  Workflow Template Steps:  ${workflowStepCount}`);
  console.log(`  Follow-Up Templates:     ${followUpCount}`);
  console.log(`  Follow-Up Template Steps: ${followUpStepCount}`);
  console.log(`  PayerTracks without follow-up: ${tracks.length - followUpCount} (no contacts in KB)`);
  console.log('═══════════════════════════════════════════════════════════');
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
