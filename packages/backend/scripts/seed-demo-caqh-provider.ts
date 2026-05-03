/**
 * Demo CAQH Provider Seed (test data — safe to remove)
 *
 * Creates a single test ProviderProfile with rich data in every section
 * the CAQH v9 coverage stack writes to: disclosures, malpractice claims,
 * hospital affiliations, work history, work history gaps, supervising
 * physicians, plus a license, board cert, and two practice locations to
 * exercise the supervisor → practice-location auto-link.
 *
 * Half the rows are tagged `source: 'caqh_sync'` and half `manual_entry`
 * so the source-badge UI is exercised. Existing manual_entry rows are
 * left alone on re-runs (matches the writer's real-world behavior).
 *
 * The provider is identified by NPI 9999999991 — clearly a test value,
 * outside any real NPI range.
 *
 * Usage:
 *   npx tsx scripts/seed-demo-caqh-provider.ts             # create / refresh
 *   npx tsx scripts/seed-demo-caqh-provider.ts --cleanup    # delete the provider (cascades)
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const CLEANUP = process.argv.includes('--cleanup');

const TEST_NPI = '9999999991';
const TEST_PROVIDER_FIRST = 'Demo';
const TEST_PROVIDER_LAST = 'CAQH-Provider';

async function findOrCreatePractice(): Promise<string | null> {
  const practice = await prisma.practice.findFirst({ select: { id: true } });
  return practice?.id ?? null;
}

async function cleanup() {
  const existing = await prisma.providerProfile.findUnique({
    where: { npi: TEST_NPI },
    select: { id: true, firstName: true, lastName: true },
  });
  if (!existing) {
    console.log(`No demo provider found at NPI ${TEST_NPI} — nothing to clean up.`);
    return;
  }
  // Cascade deletes handle every child table we wrote to.
  await prisma.providerProfile.delete({ where: { id: existing.id } });
  console.log(`Deleted demo provider ${existing.firstName} ${existing.lastName} (id ${existing.id}).`);
}

async function seed() {
  console.log(`Demo CAQH Provider Seed — NPI ${TEST_NPI}`);
  console.log('────────────────────────────────────────');

  const practiceId = await findOrCreatePractice();

  // ── ProviderProfile ──
  const provider = await prisma.providerProfile.upsert({
    where: { npi: TEST_NPI },
    create: {
      npi: TEST_NPI,
      firstName: TEST_PROVIDER_FIRST,
      lastName: TEST_PROVIDER_LAST,
      middleName: 'Test',
      dateOfBirth: new Date('1980-04-15'),
      gender: 'female',
      email: 'demo.caqh.provider@example.test',
      phone: '5125550100',
      providerType: 'psychiatrist',
      taxonomy: '2084P0800X',
      caqhProviderId: '99999991',
      caqhStatus: 'active',
      caqhLastSync: new Date(),
      hospitalBasedFlag: false,
      hospitalPrivilegeFlag: true,
      fellowshipTrainingFlag: true,
      workHistoryGapFlag: true,
      primaryPracticeState: 'TX',
      status: 'active',
      practiceId,
    },
    update: {
      firstName: TEST_PROVIDER_FIRST,
      lastName: TEST_PROVIDER_LAST,
      caqhLastSync: new Date(),
    },
  });
  console.log(`✓ Provider: ${provider.firstName} ${provider.lastName} (id ${provider.id})`);

  // ── Practice Locations ──
  const upsertLocation = async (locationName: string, addressLine1: string, isPrimary: boolean) => {
    const existing = await prisma.practiceLocation.findFirst({
      where: { providerId: provider.id, locationName },
    });
    if (existing) return existing;
    return prisma.practiceLocation.create({
      data: {
        providerId: provider.id,
        locationName,
        locationType: 'office',
        isPrimary,
        addressLine1,
        city: 'Austin',
        state: 'TX',
        zipCode: '78701',
        phone: '5125550101',
        source: 'caqh_sync',
      },
    });
  };
  const locA = await upsertLocation('Lanyard Behavioral Health', '123 Main Street', true);
  const locB = await upsertLocation('North Austin Telehealth', '456 Burnet Road', false);
  console.log(`✓ Practice locations: ${locA.locationName}, ${locB.locationName}`);

  // ── Disclosures (4 rows: 3 caqh_sync + 1 manual_entry) ──
  const disclosures = [
    {
      caqhQuestionId: '21000',
      category: 'LICENSE_ACTION' as const,
      questionText: 'Have you ever had a license suspended, restricted, or revoked?',
      answer: true,
      explanation: 'Brief 30-day administrative suspension in 2014 for late CME filing; resolved with payment of fee.',
      dateOfOccurrence: new Date('2014-09-12'),
      state: 'TX',
      source: 'caqh_sync' as const,
    },
    {
      caqhQuestionId: '21010',
      category: 'BOARD_ACTION' as const,
      questionText: 'Have you ever been reprimanded or fined by a state licensing board?',
      answer: false,
      source: 'caqh_sync' as const,
    },
    {
      caqhQuestionId: '21190',
      category: 'SUBSTANCE_ABUSE' as const,
      questionText: 'Do you currently use illegal drugs?',
      answer: false,
      source: 'caqh_sync' as const,
    },
    {
      caqhQuestionId: null,
      category: 'OTHER' as const,
      questionText: 'Internal note: provider self-attested no NPDB reports as of 2024-01-15.',
      answer: false,
      explanation: 'Cross-checked against NPDB query on file.',
      source: 'manual_entry' as const,
    },
  ];
  await prisma.providerDisclosure.deleteMany({ where: { providerId: provider.id } });
  for (const d of disclosures) {
    await prisma.providerDisclosure.create({
      data: {
        providerId: provider.id,
        category: d.category,
        questionText: d.questionText,
        answer: d.answer,
        explanation: d.explanation ?? null,
        dateOfOccurrence: d.dateOfOccurrence ?? null,
        state: d.state ?? null,
        caqhQuestionId: d.caqhQuestionId ?? null,
        source: d.source,
      },
    });
  }
  console.log(`✓ Disclosures: ${disclosures.length} rows`);

  // ── Malpractice Claims (2 rows: 1 rich CAQH-source, 1 manual stub) ──
  await prisma.malpracticeClaim.deleteMany({ where: { providerId: provider.id } });
  await prisma.malpracticeClaim.create({
    data: {
      providerId: provider.id,
      caqhClaimId: 'demo-claim-1',
      dateOfIncident: new Date('2018-03-20'),
      dateOfClaim: new Date('2019-02-11'),
      claimStatus: 'SETTLED',
      description: 'Allegation of failure to diagnose post-partum depression resulting in delayed care.',
      allegationDescription: 'Plaintiff alleged that defendant did not adequately screen for post-partum depression at the 6-week visit.',
      patientInjuryDescription: 'Patient experienced extended depressive episode requiring inpatient care.',
      isLeadDefendant: true,
      numberOtherCodefendants: 2,
      caseInvolvement: 'Treating psychiatrist; managed outpatient follow-up.',
      npdbReported: true,
      patientDied: false,
      resolutionMethod: 'Settlement',
      settlementAmount: 250000,
      settlementAmountPaid: 175000,
      dateResolved: new Date('2021-06-30'),
      insuranceCarrier: 'Aaoms National Insurance',
      policyNumber: 'AAONS-2018-44721',
      courtName: 'Travis County District Court',
      caseNumber: 'D-1-CV-19-002184',
      courtAddressLine1: '1000 Guadalupe Street',
      courtCity: 'Austin',
      courtState: 'TX',
      courtZipCode: '78701',
      courtPhone: '5128541234',
      courtCountry: 'United States',
      narrative: 'Resolved via mediation. No NPDB-reportable judgment, but settlement amount reportable per Texas state regulations.',
      source: 'caqh_sync',
    },
  });
  await prisma.malpracticeClaim.create({
    data: {
      providerId: provider.id,
      dateOfIncident: new Date('2022-08-04'),
      dateOfClaim: new Date('2023-01-15'),
      claimStatus: 'DISMISSED',
      description: 'Frivolous claim — dismissed at summary judgment.',
      isLeadDefendant: false,
      numberOtherCodefendants: 4,
      resolutionMethod: 'Judgment for Defendant',
      dateResolved: new Date('2023-09-22'),
      narrative: 'Manually entered after CAQH sync to capture the additional dismissal context.',
      source: 'manual_entry',
    },
  });
  console.log(`✓ Malpractice claims: 2 rows`);

  // ── Hospital Affiliations (3 rows) ──
  await prisma.hospitalAffiliation.deleteMany({ where: { providerId: provider.id } });
  await prisma.hospitalAffiliation.create({
    data: {
      providerId: provider.id,
      caqhAhaId: '6740549',
      facilityName: 'Ascension Seton Hays',
      facilityType: 'hospital',
      privilegeType: 'admitting',
      status: 'active',
      addressLine1: '6001 Kyle Parkway',
      city: 'Kyle',
      state: 'TX',
      zipCode: '78640',
      country: 'United States',
      phoneNumber: '5125045000',
      faxNumber: '5124595629',
      hasUnrestrictedPrivileges: true,
      hasTemporaryPrivileges: false,
      privilegeDescription: 'Full and unrestricted',
      admissionPercent: 80,
      startDate: new Date('2019-01-05'),
      staffCategory: 'Active',
      hospitalRecordType: 'Admitting Privilege Record',
      hospitalAffiliationType: 'Primary',
      department: 'Behavioral Health',
      source: 'caqh_sync',
    },
  });
  await prisma.hospitalAffiliation.create({
    data: {
      providerId: provider.id,
      caqhAhaId: '6740658',
      facilityName: 'Select Rehabilitation Hospital of San Antonio',
      facilityType: 'hospital',
      privilegeType: 'affiliate',
      status: 'active',
      addressLine1: '19126 Stonehue Road',
      city: 'San Antonio',
      state: 'TX',
      zipCode: '78258',
      country: 'United States',
      phoneNumber: '2104823400',
      faxNumber: '2104823401',
      hasUnrestrictedPrivileges: false,
      hasTemporaryPrivileges: false,
      startDate: new Date('2020-10-01'),
      staffCategory: 'Active',
      hospitalRecordType: 'Admitting Arrangement Record',
      hospitalAffiliationType: 'Other',
      whoAdmitsForYou: 'A provider in my practice',
      admittingProviderFirstName: 'Paul',
      admittingProviderLastName: 'Anthony',
      admittingContactPhone: '3583503808',
      admittingContactEmail: 'paul.anthony@example.test',
      isAdmitterSameSpecialty: false,
      description: 'Non-admitting affiliation; in-house provider admits.',
      source: 'caqh_sync',
    },
  });
  await prisma.hospitalAffiliation.create({
    data: {
      providerId: provider.id,
      caqhAhaId: '6741063',
      facilityName: 'AD Hospital East',
      facilityType: 'hospital',
      privilegeType: 'temporary',
      status: 'inactive',
      addressLine1: '12950 East Freeway',
      city: 'Houston',
      state: 'TX',
      zipCode: '77015',
      country: 'United States',
      phoneNumber: '7133303887',
      hasUnrestrictedPrivileges: false,
      hasTemporaryPrivileges: true,
      privilegeDescription: 'Temporary',
      startDate: new Date('2023-02-01'),
      endDate: new Date('2023-07-01'),
      reasonForDiscontinuance: 'Voluntary Resignation',
      exitExplanation: 'Voluntary resignation due to relocation.',
      staffCategory: 'Inactive',
      hospitalRecordType: 'Admitting Privilege Record',
      hospitalAffiliationType: 'Other',
      source: 'caqh_sync',
    },
  });
  console.log(`✓ Hospital affiliations: 3 rows`);

  // ── Work History (2 rows) ──
  await prisma.workHistory.deleteMany({ where: { providerId: provider.id } });
  await prisma.workHistory.create({
    data: {
      providerId: provider.id,
      caqhWorkHistoryId: 'demo-wh-1',
      organizationName: 'Lanyard Behavioral Health',
      organizationType: 'private_practice',
      position: 'Staff Psychiatrist',
      department: 'Behavioral Health',
      addressLine1: '123 Main Street',
      city: 'Austin',
      state: 'TX',
      zipCode: '78701',
      country: 'United States',
      phone: '5125550101',
      email: 'demo.caqh.provider@example.test',
      startDate: new Date('2020-06-15'),
      isCurrent: true,
      currentEmployerFlag: true,
      statusDescription: 'Present',
      workHistoryType: 'Current',
      source: 'caqh_sync',
    },
  });
  await prisma.workHistory.create({
    data: {
      providerId: provider.id,
      caqhWorkHistoryId: 'demo-wh-2',
      organizationName: 'Memorial Hermann Health',
      organizationType: 'hospital_system',
      position: 'Resident Psychiatrist',
      addressLine1: '6411 Fannin Street',
      city: 'Houston',
      state: 'TX',
      zipCode: '77030',
      country: 'United States',
      phone: '7137041000',
      startDate: new Date('2016-07-01'),
      endDate: new Date('2020-06-14'),
      isCurrent: false,
      currentEmployerFlag: false,
      statusDescription: 'Past',
      workHistoryType: 'Past',
      reasonForLeaving: 'Completed residency program; transitioned to outpatient practice.',
      supervisorName: 'Dr. Connie Truggian',
      supervisorPhone: '7137041010',
      source: 'caqh_sync',
    },
  });
  console.log(`✓ Work history: 2 rows`);

  // ── Work History Gaps (2 rows) ──
  await prisma.workHistoryGap.deleteMany({ where: { providerId: provider.id } });
  await prisma.workHistoryGap.create({
    data: {
      providerId: provider.id,
      caqhGapId: 'demo-gap-1',
      startDate: new Date('2014-08-01'),
      endDate: new Date('2015-08-01'),
      gapExplanation: 'Took a year off for family medical leave to care for a parent.',
      gapDescription: 'Family Leave',
      source: 'caqh_sync',
    },
  });
  await prisma.workHistoryGap.create({
    data: {
      providerId: provider.id,
      caqhGapId: 'demo-gap-2',
      startDate: new Date('2010-05-01'),
      endDate: new Date('2010-12-01'),
      gapExplanation: 'International medical mission with Doctors Without Borders.',
      gapDescription: 'Charitable Work',
      source: 'caqh_sync',
    },
  });
  console.log(`✓ Work history gaps: 2 rows`);

  // ── Supervising Physicians (2 rows: 1 linked, 1 unlinked) ──
  await prisma.supervisingPhysician.deleteMany({ where: { providerId: provider.id } });
  await prisma.supervisingPhysician.create({
    data: {
      providerId: provider.id,
      practiceLocationId: locA.id,
      caqhSupervisorId: '16172371',
      supervisorFirstName: 'Paul',
      supervisorLastName: 'Anthony',
      supervisorNpi: '1738328902',
      supervisorSpecialty: 'Psychiatry',
      supervisionType: 'COLLABORATIVE',
      agreementStartDate: new Date('2020-06-15'),
      isPrimary: true,
      department: 'Behavioral Health',
      source: 'caqh_sync',
    },
  });
  await prisma.supervisingPhysician.create({
    data: {
      providerId: provider.id,
      practiceLocationId: null, // intentionally unlinked to exercise the null-fallback path
      caqhSupervisorId: '16172362',
      supervisorFirstName: 'Connie',
      supervisorLastName: 'Truggian',
      supervisorNpi: '1992740625',
      supervisorSpecialty: 'Psychiatry',
      supervisionType: 'GENERAL',
      agreementStartDate: new Date('2016-07-01'),
      agreementEndDate: new Date('2020-06-14'),
      isPrimary: false,
      source: 'caqh_sync',
    },
  });
  console.log(`✓ Supervising physicians: 2 rows`);

  console.log('\n────────────────────────────────────────');
  console.log(`Demo provider ready. View at: /providers/${provider.id}`);
  console.log(`To remove: npx tsx scripts/seed-demo-caqh-provider.ts --cleanup`);
}

(CLEANUP ? cleanup() : seed())
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
