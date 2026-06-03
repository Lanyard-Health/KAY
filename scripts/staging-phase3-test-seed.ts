/**
 * One-shot seed script for verifying Phase 3 of the submission engine on
 * STAGING ONLY. Creates a self-contained test tuple:
 *
 *   TEST-PHASE3 Practice (UUID 00000003-…-0001)
 *     → TEST-PHASE3 User     (UUID 00000003-…-0002)
 *     → TEST-PHASE3 Provider (UUID 00000003-…-0003, NPI 9999999991)
 *     → TEST-PHASE3 Payer    (UUID 00000003-…-0004, CAQH, INDIVIDUAL)
 *         → PayerSubmissionConfig (UUID 00000003-…-0005, CAQH/API)
 *     → TEST-PHASE3 Enrollment (UUID 00000003-…-0006)
 *     → TEST-PHASE3 AgentWorkflow (UUID 00000003-…-0007, goal: submit_to_portal)
 *
 * IDs are deterministic v4-shaped UUIDs (variant 8, version 4) so the
 * upserts are idempotent AND the IDs validate against the route's
 * `z.string().uuid()` body validator. The `00000003-` prefix is the
 * cleanup namespace — `DELETE … WHERE id LIKE '00000003-%'` removes
 * everything seeded by this script and nothing else.
 *
 * Run from Render shell on kay-backend-staging:
 *   cd /opt/render/project/src && npx tsx scripts/staging-phase3-test-seed.ts
 *
 * Cleanup later:
 *   psql $DATABASE_URL_ADMIN -c \
 *     "DELETE FROM enrollment_runs WHERE enrollment_id LIKE '00000003-%'; \
 *      DELETE FROM agent_workflows WHERE id LIKE '00000003-%'; \
 *      DELETE FROM payer_enrollments WHERE id LIKE '00000003-%'; \
 *      DELETE FROM payer_adapter_configs WHERE id LIKE '00000003-%'; \
 *      DELETE FROM payers WHERE id LIKE '00000003-%'; \
 *      DELETE FROM provider_profiles WHERE id LIKE '00000003-%'; \
 *      DELETE FROM users WHERE id LIKE '00000003-%'; \
 *      DELETE FROM practices WHERE id LIKE '00000003-%';"
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Deterministic v4-shaped UUIDs. Third group starts with '4' (version 4),
// fourth group starts with '8' (variant). The "00000003-" prefix marks
// "phase 3 test fixture" and is the cleanup namespace.
const PRACTICE_ID   = '00000003-0000-4000-8000-000000000001';
const USER_ID       = '00000003-0000-4000-8000-000000000002';
const PROVIDER_ID   = '00000003-0000-4000-8000-000000000003';
const PAYER_ID      = '00000003-0000-4000-8000-000000000004';
const SUB_CONFIG_ID = '00000003-0000-4000-8000-000000000005';
const ENROLLMENT_ID = '00000003-0000-4000-8000-000000000006';
const WORKFLOW_ID   = '00000003-0000-4000-8000-000000000007';

async function main() {
  console.log('=== Phase 3 staging test seed — starting ===\n');

  // 1. Practice
  const practice = await prisma.practice.upsert({
    where: { id: PRACTICE_ID },
    create: {
      id: PRACTICE_ID,
      name: 'TEST-PHASE3 Practice',
      organizationType: 'private_practice',
      email: 'test-phase3@dev.local',
      addressLine1: '123 Test St',
      city: 'Testville',
      state: 'CA',
      zipCode: '94102',
    },
    update: {},
  });
  console.log(`Practice: ${practice.id}`);

  // 2. User (AgentWorkflow.requestedBy is an FK to users.id, so we need a real row)
  const user = await prisma.user.upsert({
    where: { id: USER_ID },
    create: {
      id: USER_ID,
      cognitoId: 'test-phase3-cognito-uuid',
      email: 'test-phase3-user-uuid@dev.local',
      firstName: 'TestPhase3',
      lastName: 'User',
      role: 'admin',
    },
    update: {},
  });
  console.log(`User: ${user.id}`);

  // 3. Provider linked to the practice
  const provider = await prisma.providerProfile.upsert({
    where: { id: PROVIDER_ID },
    create: {
      id: PROVIDER_ID,
      practiceId: practice.id,
      npi: '9999999992',
      firstName: 'TestPhase3',
      lastName: 'Provider',
      email: 'test-phase3-provider-uuid@dev.local',
      phone: '555-000-0001',
      providerType: 'psychiatrist',
      dateOfBirth: new Date('1980-01-01'),
      gender: 'prefer_not_to_say',
      status: 'active',
    },
    update: { practiceId: practice.id },
  });
  console.log(`Provider: ${provider.id}`);

  // 4. CAQH-routed payer
  const payer = await prisma.payer.upsert({
    where: { id: PAYER_ID },
    create: {
      id: PAYER_ID,
      name: 'TEST-PHASE3 CAQH Payer',
      payerId: 'TEST-PHASE3-CAQH-UUID',
      payerType: 'Medical',
      credentialType: 'INDIVIDUAL',
    },
    update: {},
  });
  console.log(`Payer: ${payer.id}`);

  // 5. PayerSubmissionConfig — the row that actually routes to the CAQH adapter
  const subConfig = await prisma.payerSubmissionConfig.upsert({
    where: { id: SUB_CONFIG_ID },
    create: {
      id: SUB_CONFIG_ID,
      payerId: payer.id,
      adapterType: 'CAQH',
      submissionMethod: 'API',
      config: {},
      requiredFields: ['npi', 'firstName', 'lastName', 'dateOfBirth'],
      isActive: true,
    },
    update: {},
  });
  console.log(`SubmissionConfig: ${subConfig.id} (adapterType=CAQH)`);

  // 6. Enrollment linking provider + payer
  const enrollment = await prisma.enrollment.upsert({
    where: { id: ENROLLMENT_ID },
    create: {
      id: ENROLLMENT_ID,
      providerId: provider.id,
      payerId: payer.id,
      status: 'not_started',
    },
    update: {},
  });
  console.log(`Enrollment: ${enrollment.id}`);

  // 7. AgentWorkflow — the route requires a workflowId in the URL
  const workflow = await prisma.agentWorkflow.upsert({
    where: { id: WORKFLOW_ID },
    create: {
      id: WORKFLOW_ID,
      providerId: provider.id,
      payerId: payer.id,
      practiceId: practice.id,
      enrollmentId: enrollment.id,
      goal: 'submit_to_portal',
      goalParams: {
        providerId: provider.id,
        payerId: payer.id,
        enrollmentId: enrollment.id,
      },
      status: 'active',
      requestedBy: user.id,
    },
    update: {},
  });
  console.log(`Workflow: ${workflow.id}`);

  console.log('\n=== Seed complete — use these IDs for the curl ===\n');
  console.log(`WORKFLOW_ID=${workflow.id}`);
  console.log(`PROVIDER_ID=${provider.id}`);
  console.log(`PAYER_ID=${payer.id}`);
  console.log(`ENROLLMENT_ID=${enrollment.id}`);
  console.log('\nCurl (after flag flip):');
  console.log(
    `curl -i -X POST https://kay-backend-staging.onrender.com/api/v1/agent/workflows/${workflow.id}/submit-to-portal \\\n  -H 'Content-Type: application/json' \\\n  -d '{"providerId":"${provider.id}","payerId":"${payer.id}","enrollmentId":"${enrollment.id}"}'`
  );
}

main()
  .catch((e) => {
    console.error('\nSeed FAILED:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
