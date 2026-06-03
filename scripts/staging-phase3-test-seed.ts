/**
 * One-shot seed script for verifying Phase 3 of the submission engine on
 * STAGING ONLY. Creates a self-contained test tuple:
 *
 *   TEST-PHASE3 Practice
 *     → TEST-PHASE3 Provider (NPI 1234567890, CAQH-ready fields)
 *     → TEST-PHASE3 Payer (CAQH-routed, INDIVIDUAL credential)
 *         → PayerSubmissionConfig (adapterType: CAQH, submissionMethod: API)
 *     → TEST-PHASE3 Enrollment (provider + payer)
 *     → TEST-PHASE3 AgentWorkflow (goal: submit_to_portal)
 *
 * Run from Render shell on kay-backend-staging:
 *   cd /opt/render/project/src && npx tsx scripts/staging-phase3-test-seed.ts
 *
 * The script is idempotent — if any TEST-PHASE3-* row already exists, it
 * reuses it and only creates the missing pieces. Prints the workflow ID
 * (and the rest) at the end, which is what you'll curl against.
 *
 * Cleanup later:
 *   psql $DATABASE_URL_ADMIN -c \
 *     "DELETE FROM enrollment_runs WHERE enrollment_id IN (SELECT id FROM enrollments WHERE id LIKE 'test-phase3-%'); \
 *      DELETE FROM agent_workflows WHERE id LIKE 'test-phase3-%'; \
 *      DELETE FROM enrollments WHERE id LIKE 'test-phase3-%'; \
 *      DELETE FROM payer_adapter_configs WHERE id LIKE 'test-phase3-%'; \
 *      DELETE FROM payers WHERE id LIKE 'test-phase3-%'; \
 *      DELETE FROM provider_profiles WHERE id LIKE 'test-phase3-%'; \
 *      DELETE FROM users WHERE id LIKE 'test-phase3-%'; \
 *      DELETE FROM practices WHERE id LIKE 'test-phase3-%';"
 *
 * (Use DATABASE_URL_ADMIN because the lanyard_app role has the trigger-
 * protected restrictions on audit_logs — but for cleanup of TEST data,
 * neither audit_logs nor anything trigger-protected is in scope.)
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const TEST_PREFIX = 'test-phase3';

async function main() {
  console.log('=== Phase 3 staging test seed — starting ===\n');

  // 1. Practice
  const practice = await prisma.practice.upsert({
    where: { id: `${TEST_PREFIX}-practice` },
    create: {
      id: `${TEST_PREFIX}-practice`,
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
    where: { id: `${TEST_PREFIX}-user` },
    create: {
      id: `${TEST_PREFIX}-user`,
      cognitoId: `${TEST_PREFIX}-cognito`,
      email: 'test-phase3-user@dev.local',
      firstName: 'TestPhase3',
      lastName: 'User',
      role: 'admin',
    },
    update: {},
  });
  console.log(`User: ${user.id}`);

  // 3. Provider linked to the practice
  const provider = await prisma.providerProfile.upsert({
    where: { id: `${TEST_PREFIX}-provider` },
    create: {
      id: `${TEST_PREFIX}-provider`,
      practiceId: practice.id,
      npi: '1234567890',
      firstName: 'TestPhase3',
      lastName: 'Provider',
      email: 'test-phase3-provider@dev.local',
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
    where: { id: `${TEST_PREFIX}-payer` },
    create: {
      id: `${TEST_PREFIX}-payer`,
      name: 'TEST-PHASE3 CAQH Payer',
      payerId: 'TEST-PHASE3-CAQH',
      payerType: 'Medical',
      credentialType: 'INDIVIDUAL',
    },
    update: {},
  });
  console.log(`Payer: ${payer.id}`);

  // 5. PayerSubmissionConfig — the row that actually routes to the CAQH adapter
  const subConfig = await prisma.payerSubmissionConfig.upsert({
    where: { id: `${TEST_PREFIX}-config` },
    create: {
      id: `${TEST_PREFIX}-config`,
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
    where: { id: `${TEST_PREFIX}-enrollment` },
    create: {
      id: `${TEST_PREFIX}-enrollment`,
      providerId: provider.id,
      payerId: payer.id,
      status: 'not_started',
    },
    update: {},
  });
  console.log(`Enrollment: ${enrollment.id}`);

  // 7. AgentWorkflow — the route requires a workflowId in the URL
  const workflow = await prisma.agentWorkflow.upsert({
    where: { id: `${TEST_PREFIX}-workflow` },
    create: {
      id: `${TEST_PREFIX}-workflow`,
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
