/**
 * Demo-video seed (LOCAL ONLY — camera-ready synthetic data)
 *
 * Builds "Brightpath Behavioral Health": a realistic-looking practice for the
 * marketing demo recording. Renames the dev-bypass practice-admin and provider
 * users so no "Dev" ever appears on screen, and seeds providers, payers with
 * ETA timelines, staggered enrollments (incl. one "Running long"), attestation
 * trackers in every bucket, expiring licenses, a completed CAQH import with
 * sync history + documents, and one pending provider application to approve.
 *
 * Every synthetic person is fictional; NPIs are 99-prefixed test values.
 *
 * Usage (from packages/backend):
 *   npx tsx src/scripts/seed-demo-video.ts             # create / refresh
 *   npx tsx src/scripts/seed-demo-video.ts --cleanup   # remove seeded rows
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const CLEANUP = process.argv.includes('--cleanup');

// ponytail: hard guard — this script must never touch a remote DB
if (process.env['NODE_ENV'] === 'production') {
  console.error('Refusing to run: NODE_ENV=production');
  process.exit(1);
}
const dbUrl = process.env['DATABASE_URL'] ?? '';
if (dbUrl && !dbUrl.includes('localhost') && !dbUrl.includes('127.0.0.1')) {
  console.error('Refusing to run: DATABASE_URL is not localhost');
  process.exit(1);
}

const P = 'demovid-'; // deterministic id prefix for idempotent re-runs/cleanup

const day = 86_400_000;
const now = Date.now();
const daysAgo = (n: number) => new Date(now - n * day);
const daysAhead = (n: number) => new Date(now + n * day);

// ── Synthetic cast (all fictional) ─────────────────────────────────────────
const PROVIDERS = [
  { key: 'raman',    first: 'Priya',  last: 'Raman',    type: 'psychiatrist', degree: 'md',   npi: '9900000001', gender: 'female' },
  { key: 'whitfield',first: 'Sarah',  last: 'Whitfield',type: 'psychologist', degree: 'phd',  npi: '9900000002', gender: 'female' },
  { key: 'bell',     first: 'Marcus', last: 'Bell',     type: 'lcsw',         degree: 'msw',  npi: '9900000003', gender: 'male' },
  { key: 'nguyen',   first: 'Alicia', last: 'Nguyen',   type: 'pmhnp',        degree: 'dnp',  npi: '9900000004', gender: 'female' },
  { key: 'fields',   first: 'Jordan', last: 'Fields',   type: 'lpc',          degree: 'ma',   npi: '9900000005', gender: 'other' },
  { key: 'okafor',   first: 'David',  last: 'Okafor',   type: 'lmft',         degree: 'ms',   npi: '9900000006', gender: 'male' },
  { key: 'sokolov',  first: 'Elena',  last: 'Sokolov',  type: 'psychologist', degree: 'psyd', npi: '9900000007', gender: 'female' },
] as const;

const PAYERS = [
  { key: 'aetna',  name: 'Aetna',                         payerId: `${P}aetna`,  min: 45, max: 90 },
  { key: 'cigna',  name: 'Cigna',                         payerId: `${P}cigna`,  min: 30, max: 60 },
  { key: 'uhc',    name: 'UnitedHealthcare',              payerId: `${P}uhc`,    min: 45, max: 90 },
  { key: 'optum',  name: 'Optum Behavioral Health',       payerId: `${P}optum`,  min: 30, max: 75 },
  { key: 'humana', name: 'Humana',                        payerId: `${P}humana`, min: 30, max: 60 },
  { key: 'gamcd',  name: 'Medicaid Georgia',              payerId: 'GAMCD' /* realistic on camera; cleaned up by name below */,  min: 60, max: 120,
    notes: 'Also known as: Georgia Medicaid, Peach State Health Plan, GA Medicaid' },
] as const;

// enrollments: [providerKey, payerKey, status, appDaysAgo, effDaysAgo]
// ETA bars need submitted/pending_review + applicationDate; "Running long" needs
// dayCount > payer maxDays (bell/gamcd: 130 days elapsed vs max 120).
const ENROLLMENTS: Array<[string, string, string, number | null, number | null]> = [
  ['raman',     'aetna',  'approved',       200, 130],
  ['raman',     'cigna',  'approved',       160, 100],
  ['raman',     'uhc',    'submitted',       30, null],
  ['raman',     'gamcd',  'in_progress',   null, null],
  ['whitfield', 'aetna',  'approved',       150,  75],
  ['whitfield', 'optum',  'approved',        90,  20],
  ['whitfield', 'cigna',  'submitted',       12, null],
  ['bell',      'cigna',  'approved',       120,  55],
  ['bell',      'gamcd',  'pending_review', 130, null], // ← Running long (max 120)
  ['bell',      'humana', 'approved',        60,   5],  // approved this month
  ['nguyen',    'aetna',  'pending_review',  50, null],
  ['nguyen',    'uhc',    'approved',       140,  70],
  ['nguyen',    'humana', 'in_progress',   null, null],
  ['fields',    'optum',  'approved',       100,  30],
  ['fields',    'cigna',  'submitted',       20, null],
  ['fields',    'aetna',  'not_started',   null, null],
  ['okafor',    'humana', 'approved',        45,   2],  // approved this month
  ['okafor',    'gamcd',  'in_progress',   null, null],
  ['okafor',    'uhc',    'denied',          90, null],
  ['sokolov',   'aetna',  'approved',       170,  95],
  ['sokolov',   'optum',  'submitted',       25, null],
];

// attestation buckets: overdue / due-soon / on-track / untracked
const ATTESTATIONS: Array<[string, number | null, string | null, string]> = [
  ['raman',     -14, 'Expired Attestation', 'changed'],
  ['whitfield',  10, 'Re-Attestation',      'unchanged'],
  ['bell',       18, 'Re-Attestation',      'unchanged'],
  ['nguyen',     60, 'Initial Attestation', 'unchanged'],
  ['fields',     75, 'Initial Attestation', 'no_baseline'],
  ['okafor',    null, null,                 'no_baseline'],
];

// license expirations: hit the 0-30 / 31-60 / 61-90 forecast buckets
const LICENSE_EXPIRY_DAYS: Record<string, number> = {
  raman: 21, whitfield: 45, bell: 80, nguyen: 400, fields: 500, okafor: 300, sokolov: 65,
};

async function cleanup() {
  await prisma.caqhSyncLog.deleteMany({ where: { id: { startsWith: P } } });
  await prisma.document.deleteMany({ where: { id: { startsWith: P } } });
  await prisma.caqhAttestationTracker.deleteMany({ where: { id: { startsWith: P } } });
  await prisma.enrollment.deleteMany({ where: { id: { startsWith: P } } });
  await prisma.providerApplication.deleteMany({ where: { npi: '9900000099' } });
  await prisma.education.deleteMany({ where: { id: { startsWith: P } } });
  await prisma.workHistory.deleteMany({ where: { id: { startsWith: P } } });
  await prisma.malpracticeInsurance.deleteMany({ where: { id: { startsWith: P } } });
  await prisma.boardCertification.deleteMany({ where: { id: { startsWith: P } } });
  await prisma.license.deleteMany({ where: { id: { startsWith: P } } });
  await prisma.practiceLocation.deleteMany({ where: { id: { startsWith: P } } });
  await prisma.providerProfile.deleteMany({ where: { npi: { startsWith: '99000000' } } });
  await prisma.workflowTemplateStep.deleteMany({ where: { id: { startsWith: P } } });
  await prisma.workflowTemplate.deleteMany({ where: { id: { startsWith: P } } });
  await prisma.payerTimeline.deleteMany({ where: { id: { startsWith: P } } });
  await prisma.payerTrack.deleteMany({ where: { id: { startsWith: P } } });
  await prisma.payer.deleteMany({ where: { OR: [{ payerId: { startsWith: P } }, { payerId: 'GAMCD' }] } });
  console.log('demo-video seed rows removed (dev user/practice renames left in place)');
}

async function main() {
  if (CLEANUP) return cleanup();
  await cleanup(); // idempotent refresh

  // 1. Rename the dev-bypass practice admin → Maya Alvarez (fixes "Good morning, Dev")
  const admin = await prisma.user.upsert({
    where: { cognitoId: 'dev-practice-admin-cognito-id' },
    update: { firstName: 'Maya', lastName: 'Alvarez', role: 'practice_admin' },
    create: {
      cognitoId: 'dev-practice-admin-cognito-id',
      email: 'practiceadmin@dev.local',
      firstName: 'Maya',
      lastName: 'Alvarez',
      role: 'practice_admin',
      isActive: true,
    },
  });

  // 2. The practice — reuse the admin's existing practice if linked, else create
  const membership = await prisma.userPractice.findFirst({ where: { userId: admin.id } });
  const practiceData = {
    name: 'Brightpath Behavioral Health',
    status: 'ACTIVE' as const,
    email: 'hello@brightpathbh.example',
    phone: '(404) 555-0142',
    addressLine1: '1180 Peachtree Street NE',
    addressLine2: 'Suite 400',
    city: 'Atlanta',
    state: 'GA',
    zipCode: '30309',
    states: ['GA'],
    isDemo: true,
    setupComplete: true,
  };
  const practice = membership
    ? await prisma.practice.update({ where: { id: membership.practiceId }, data: practiceData })
    : await prisma.practice.create({ data: practiceData });
  if (!membership) {
    await prisma.userPractice.create({
      data: { userId: admin.id, practiceId: practice.id, role: 'SUPER_ADMIN' },
    });
  }

  // 1b. Rename the dev admin too (top-right header shows their name in admin scenes)
  await prisma.user.updateMany({
    where: { cognitoId: 'dev-cognito-id' },
    data: { firstName: 'Nina', lastName: 'Patel' },
  });
  // stale pending approvals from old test runs pop an "AI needs approval" toast on camera
  const staleApprovals = await prisma.pendingApproval.updateMany({
    where: { status: 'pending' },
    data: { status: 'expired' },
  });
  if (staleApprovals.count) console.log(`expired ${staleApprovals.count} stale pending approvals`);

  // 2b. Quarantine pre-existing local test providers: detach them from the demo
  // practice so old data ("Smoke Test", "Demo CAQH-Provider", duplicate payer
  // columns, stale AI nudges) never appears on camera. Reversible — detach, not delete.
  const strays = await prisma.providerProfile.findMany({
    where: { practiceId: practice.id, npi: { not: { startsWith: '99000000' } } },
    select: { id: true, firstName: true, lastName: true },
  });
  if (strays.length) {
    await prisma.providerProfile.updateMany({
      where: { id: { in: strays.map((s) => s.id) } },
      data: { practiceId: null },
    });
    await prisma.aiRecommendation.updateMany({
      where: { providerId: { in: strays.map((s) => s.id) }, status: 'pending' },
      data: { status: 'dismissed' },
    });
    console.log(`detached ${strays.length} stray providers: ${strays.map((s) => `${s.firstName} ${s.lastName}`).join(', ')}`);
  }
  // stray practice-wide (provider-less) enrollments add ghost payer columns to the grid
  const strayPracticeEnr = await prisma.enrollment.deleteMany({
    where: { practiceId: practice.id, providerId: null, id: { not: { startsWith: P } } },
  });
  if (strayPracticeEnr.count) console.log(`removed ${strayPracticeEnr.count} stray practice-wide enrollments`);

  // 3. Payers + tracks + Initial timelines (ETA bars read these)
  const payerIds: Record<string, string> = {};
  const trackIds: Record<string, string> = {};
  for (const p of PAYERS) {
    const payer = await prisma.payer.upsert({
      where: { payerId: p.payerId },
      update: { name: p.name, notes: (p as { notes?: string }).notes ?? null },
      create: {
        name: p.name,
        payerId: p.payerId,
        payerType: p.key === 'gamcd' ? 'Medicaid' : 'Commercial',
        notes: (p as { notes?: string }).notes ?? null,
      },
    });
    payerIds[p.key] = payer.id;
    const track = await prisma.payerTrack.upsert({
      where: { payerName_track_stateRegion: { payerName: p.name, track: 'Behavioral Health — Demo', stateRegion: 'GA' } },
      update: {},
      create: {
        id: `${P}track-${p.key}`,
        payerName: p.name,
        payerType: p.key === 'gamcd' ? 'Medicaid' : 'Commercial',
        stateRegion: 'GA',
        track: 'Behavioral Health — Demo',
        submissionMethod: 'portal',
      },
    });
    trackIds[p.key] = track.id;
    await prisma.payerTimeline.upsert({
      where: { payerTrackId_processType: { payerTrackId: track.id, processType: 'Initial' } },
      update: { minDays: p.min, maxDays: p.max },
      create: { id: `${P}tl-${p.key}`, payerTrackId: track.id, processType: 'Initial', minDays: p.min, maxDays: p.max },
    });
  }

  // 3b. Workflow template for Medicaid Georgia — creating that enrollment on
  // camera instantiates this checklist live (scene 4)
  await prisma.workflowTemplateStep.deleteMany({ where: { id: { startsWith: P } } });
  await prisma.workflowTemplate.deleteMany({ where: { id: { startsWith: P } } });
  await prisma.workflowTemplate.create({
    data: {
      id: `${P}wf-gamcd`,
      payerTrackId: trackIds['gamcd']!,
      name: 'Medicaid Georgia — Behavioral Health',
      status: 'active',
      createdBy: 'system-seed',
      publishedAt: daysAgo(30),
      steps: {
        create: [
          { id: `${P}wfs-1`, stepType: 'readiness_check', owner: 'credentialing_staff', stepOrder: 1, name: 'Verify CAQH profile is current', description: 'Confirm attestation is under 120 days old and all sections are complete.', estimatedDaysMin: 0, estimatedDaysMax: 1 },
          { id: `${P}wfs-2`, stepType: 'readiness_check', owner: 'credentialing_staff', stepOrder: 2, name: 'Confirm Georgia Medicaid ID', description: 'Provider must hold an active GA Medicaid provider ID before the payer application.', estimatedDaysMin: 1, estimatedDaysMax: 5 },
          { id: `${P}wfs-3`, stepType: 'populate_template', owner: 'credentialing_staff', stepOrder: 3, name: 'Gather required documents', description: 'License, malpractice certificate of insurance, W-9.', requiredDocuments: ['license', 'malpractice_certificate', 'w9'], estimatedDaysMin: 1, estimatedDaysMax: 3 },
          { id: `${P}wfs-4`, stepType: 'submit_application', owner: 'credentialing_staff', stepOrder: 4, name: 'Submit application via portal', description: 'File through the GAMMIS provider enrollment portal.', estimatedDaysMin: 1, estimatedDaysMax: 2 },
          { id: `${P}wfs-5`, stepType: 'follow_up', owner: 'credentialing_staff', stepOrder: 5, name: 'Follow up with payer', description: 'Check status every 14 days until determination.', triggerDaysAfterPrev: 14, estimatedDaysMin: 30, estimatedDaysMax: 90 },
        ],
      },
    },
  });

  // 4. Providers + licenses + board certs + a practice location each
  const providerIds: Record<string, string> = {};
  for (const pr of PROVIDERS) {
    const provider = await prisma.providerProfile.create({
      data: {
        npi: pr.npi,
        firstName: pr.first,
        lastName: pr.last,
        gender: pr.gender as 'male' | 'female' | 'other',
        email: `${pr.first.toLowerCase()}.${pr.last.toLowerCase()}@brightpathbh.example`,
        phone: '(404) 555-0177',
        providerType: pr.type as 'psychiatrist',
        degree: pr.degree as 'md',
        specialties: ['Behavioral Health'],
        status: 'active',
        practiceId: practice.id,
        primaryPracticeState: 'GA',
      },
    });
    providerIds[pr.key] = provider.id;

    await prisma.practiceLocation.create({
      data: {
        id: `${P}loc-${pr.key}`,
        providerId: provider.id,
        practiceId: practice.id,
        locationName: 'Brightpath Midtown',
        locationType: 'office',
        isPrimary: true,
        addressLine1: '1180 Peachtree Street NE',
        city: 'Atlanta',
        state: 'GA',
        zipCode: '30309',
        phone: '(404) 555-0142',
      },
    });

    await prisma.license.create({
      data: {
        id: `${P}lic-${pr.key}`,
        providerId: provider.id,
        licenseType: pr.type === 'psychiatrist' ? 'state_medical'
          : pr.type === 'psychologist' ? 'state_psychology'
          : pr.type === 'lcsw' ? 'state_social_work'
          : pr.type === 'lmft' ? 'state_marriage_family'
          : 'state_counseling',
        licenseNumber: `GA-${pr.npi.slice(-5)}`,
        state: 'GA',
        issueDate: daysAgo(700),
        expirationDate: daysAhead(LICENSE_EXPIRY_DAYS[pr.key] ?? 365),
        status: 'active',
      },
    });

    await prisma.boardCertification.create({
      data: {
        id: `${P}cert-${pr.key}`,
        providerId: provider.id,
        boardType: 'other',
        boardName: pr.type === 'psychiatrist' ? 'American Board of Psychiatry and Neurology' : 'National Board for Certified Counselors',
        specialty: 'Behavioral Health',
        expirationDate: daysAhead(600),
        status: 'active',
      },
    });
  }

  // 5. Enrollments
  for (const [prov, payer, status, appAgo, effAgo] of ENROLLMENTS) {
    await prisma.enrollment.create({
      data: {
        id: `${P}enr-${prov}-${payer}`,
        providerId: providerIds[prov]!,
        payerId: payerIds[payer]!,
        payerTrackId: trackIds[payer]!,
        status: status as 'approved',
        applicationDate: appAgo !== null ? daysAgo(appAgo) : null,
        effectiveDate: effAgo !== null ? daysAgo(effAgo) : null,
        nextFollowUpDate: status === 'pending_review' ? daysAgo(3) : null, // overdue follow-up for attention panel
      },
    });
  }

  // 6. Attestation trackers
  for (const [prov, dueInDays, provStatus, verdict] of ATTESTATIONS) {
    await prisma.caqhAttestationTracker.create({
      data: {
        id: `${P}att-${prov}`,
        providerProfileId: providerIds[prov]!,
        nextDueDate: dueInDays !== null ? daysAhead(dueInDays) : null,
        lastAttestationDate: dueInDays !== null ? daysAgo(120 - dueInDays) : null,
        providerStatus: provStatus,
        diffVerdict: verdict,
        changedSections: verdict === 'changed' ? ['Practice Locations'] : [],
      },
    });
  }

  // 7. Scene 3: Sarah Whitfield has a completed CAQH import w/ history + documents
  const sw = providerIds['whitfield']!;
  await prisma.providerProfile.update({
    where: { id: sw },
    data: {
      caqhProviderId: '99990001',
      caqhStatus: 'active',
      caqhLastSync: daysAgo(0),
      caqhImportStatus: 'completed',
      caqhImportUpdatedAt: daysAgo(0),
      // no taxonomy: TaxonomyAssistant has a case-mismatch bug (map keys are
      // capitalized, enum is lowercase) that falsely flags valid codes in amber
      caqhUsername: 'sarah.whitfield',
      caqhCredentialsValid: true,
      caqhCredentialsLastChecked: daysAgo(0),
    },
  });
  // real rows behind the "sections filled" story, so section counts aren't (0)
  await prisma.education.createMany({
    data: [
      { id: `${P}edu-1`, providerId: sw, institutionName: 'Emory University', degree: 'phd', educationType: 'GRADUATE_SCHOOL' },
      { id: `${P}edu-2`, providerId: sw, institutionName: 'University of Georgia', degree: 'ba', educationType: 'UNDERGRADUATE' },
      { id: `${P}edu-3`, providerId: sw, institutionName: 'Grady Health System', degree: 'phd', educationType: 'INTERNSHIP' },
    ],
  });
  await prisma.workHistory.createMany({
    data: [
      { id: `${P}wh-1`, providerId: sw, organizationName: 'Brightpath Behavioral Health', position: 'Staff Psychologist', startDate: daysAgo(400), isCurrent: true },
      { id: `${P}wh-2`, providerId: sw, organizationName: 'Atlanta Counseling Collective', position: 'Psychologist', startDate: daysAgo(1500), endDate: daysAgo(410) },
    ],
  });
  await prisma.malpracticeInsurance.create({
    data: {
      id: `${P}mp-1`, providerId: sw, carrierName: 'CPH & Associates', policyNumber: 'CPH-448812',
      perClaimAmount: 1_000_000, aggregateAmount: 3_000_000, coverageType: 'occurrence',
      effectiveDate: daysAgo(200), expirationDate: daysAhead(165),
    },
  });
  // newest sync carries the rich change log — the import panel shows the LAST completed sync
  const syncRuns = [
    { id: `${P}sync-1`, started: daysAgo(2), dur: 12_000, changes: { licenses: { created: 0, updated: 1 } } },
    { id: `${P}sync-2`, started: daysAgo(1), dur: 9_000, changes: { specialties: { created: 1, updated: 0 } } },
    { id: `${P}sync-3`, started: daysAgo(0), dur: 41_000, changes: { licenses: { created: 2, updated: 0 }, certifications: { created: 1, updated: 0 }, education: { created: 3, updated: 0 }, malpractice: { created: 1, updated: 0 }, workHistory: { created: 2, updated: 0 } } },
  ];
  for (const s of syncRuns) {
    await prisma.caqhSyncLog.create({
      data: {
        id: s.id,
        providerId: sw,
        direction: 'pull',
        status: 'completed',
        startedAt: s.started,
        completedAt: new Date(s.started.getTime() + s.dur),
        durationMs: s.dur,
        changesApplied: s.changes,
      },
    });
  }
  const docs = [
    { type: 'license', name: 'GA-Psychology-License.pdf', linked: `${P}lic-whitfield` },
    { type: 'malpractice_certificate', name: 'Malpractice-COI-2026.pdf', linked: null },
    { type: 'cv_resume', name: 'Whitfield-CV.pdf', linked: null },
    { type: 'w9', name: 'W9-Whitfield.pdf', linked: null },
  ];
  for (const [i, d] of docs.entries()) {
    await prisma.document.create({
      data: {
        id: `${P}doc-${i}`,
        providerId: sw,
        fileName: d.name,
        originalFileName: d.name,
        fileSize: 220_000 + i * 10_000,
        mimeType: 'application/pdf',
        s3Key: `demo-video/${d.name}`,
        documentType: d.type as 'license',
        linkedLicenseId: d.linked,
        reviewStatus: i < 2 ? 'pending' : 'approved',
        expirationDate: d.type === 'license' ? daysAhead(45) : null,
      },
    });
  }

  // 8. Scene 1/2: rename the dev provider → Jasmine Carter and leave a pending application
  const devProviderUser = await prisma.user.findUnique({ where: { cognitoId: 'dev-provider-cognito-id' } })
    ?? await prisma.user.findFirst({ where: { email: 'provider@dev.local' } });
  if (devProviderUser) {
    await prisma.user.update({
      where: { id: devProviderUser.id },
      data: { firstName: 'Jasmine', lastName: 'Carter' },
    });
    if (devProviderUser.providerId) {
      await prisma.providerProfile.update({
        where: { id: devProviderUser.providerId },
        data: {
          firstName: 'Jasmine',
          lastName: 'Carter',
          providerType: 'lmft',
          degree: 'ms',
          practiceId: practice.id,
          onboardingCompletedAt: null,
          // npi prefix 9911 deliberately outside the 99000000 cleanup range —
          // this is the dev-bypass provider's profile, never deleted by cleanup
          npi: '9911111199',
          email: 'jasmine.carter@brightpathbh.example',
          phone: '(404) 555-0163',
        },
      });
      // her old local test enrollments reference stale payer rows → duplicate grid columns
      await prisma.enrollment.deleteMany({
        where: { providerId: devProviderUser.providerId, id: { not: { startsWith: P } } },
      });
    }
  }
  await prisma.providerApplication.create({
    data: {
      npi: '9900000099',
      firstName: 'Jasmine',
      lastName: 'Carter',
      email: 'jasmine.carter@brightpathbh.example',
      phone: '(404) 555-0163',
      dateOfBirth: new Date('1990-03-14'),
      gender: 'female',
      providerType: 'lmft',
      specialties: ['Marriage and Family Therapy'],
      caqhProviderId: '99990002',
      practiceId: practice.id,
      status: 'pending',
    },
  });

  console.log(`Seeded Brightpath Behavioral Health (practice ${practice.id})`);
  console.log(`- admin login: dev practice-admin button → Maya Alvarez`);
  console.log(`- providers: ${Object.keys(providerIds).length}, enrollments: ${ENROLLMENTS.length}`);
  console.log(`- scene-3 provider (CAQH import complete): Sarah Whitfield ${sw}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
