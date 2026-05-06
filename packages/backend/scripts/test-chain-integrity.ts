/**
 * Phase 0.A PR 2 — chain & signature integrity smoke test against the local dev DB.
 *
 * Verifies the parts of `logAgentEvent` that mocked unit tests cannot:
 *   1. 100 sequential calls produce a valid hash chain (every prevHash matches the
 *      previous row's eventHash; every signature verifies against the public key).
 *   2. 10 parallel calls all land in the same workflow chain without forks
 *      (Postgres serializable + retry path) and verify cleanly.
 *   3. External-style verification using the public key from getKeyset().
 *
 * Prerequisites:
 *   - Local Postgres running (docker compose up -d).
 *   - Migration 20260506150238_add_agent_event_signing_and_chain applied.
 *   - At least one AgentWorkflow row exists (we reuse its FK).
 *
 * Usage:
 *   cd packages/backend
 *   npx tsx scripts/test-chain-integrity.ts
 *
 * The script generates a fresh ed25519 keypair, sets the signing env vars
 * in-process only, runs the writes, asserts the chain, then deletes only the
 * agent_events rows it created. AgentWorkflow rows are not modified.
 */
import { generateKeyPairSync, createHash } from 'node:crypto';

import { prisma } from '../src/utils/prisma.js';
import { logAgentEvent } from '../src/agents/event-logger.js';
import { canonicalize, verifyAgentEvent, getKeyset } from '../src/utils/agent-signing.js';

function fail(msg: string): never {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

async function setupSigningEnv() {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  process.env['AGENT_SIGNING_PRIVATE_KEY'] = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
  process.env['AGENT_SIGNING_PUBLIC_KEY'] = publicKey.export({ type: 'spki', format: 'pem' }) as string;
  process.env['AGENT_SIGNING_KEY_ID'] = `chain-test-${Date.now()}`;
  process.env['AGENT_SIGNING_MODE'] = 'enforce';
}

async function pickWorkflowId(): Promise<string> {
  const wf = await prisma.agentWorkflow.findFirst({ select: { id: true } });
  if (!wf) {
    fail('no AgentWorkflow rows in dev DB — seed one before running this script');
  }
  return wf.id;
}

interface ChainRow {
  id: string;
  workflowId: string;
  taskId: string | null;
  agent: string;
  action: string;
  data: unknown;
  level: string;
  timestamp: Date;
  prevHash: string | null;
  eventHash: string | null;
  signature: string | null;
  signatureKeyId: string | null;
}

function rebuildCanonical(row: ChainRow): string {
  return canonicalize({
    id: row.id,
    workflowId: row.workflowId,
    taskId: row.taskId,
    agent: row.agent,
    action: row.action,
    data: row.data,
    level: row.level,
    timestamp: row.timestamp.toISOString(),
    prevHash: row.prevHash,
  });
}

function verifyChain(rows: ChainRow[], publicKeyPem: string, label: string): void {
  if (rows.length === 0) fail(`${label}: empty chain`);

  const ordered = [...rows].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

  let expectedPrev: string | null = null;
  for (let i = 0; i < ordered.length; i++) {
    const row = ordered[i]!;

    // Some rows in a real workflow may pre-date this run. The chain segment
    // we wrote starts from the first row whose prevHash matches the prior
    // tail (or null on the first call when nothing existed yet). We only
    // check the segment we wrote.
    if (i === 0 && row.prevHash !== null) {
      // First row of our segment is allowed to chain to whatever was already in the workflow.
      expectedPrev = row.prevHash;
    }

    if (row.prevHash !== expectedPrev) {
      fail(
        `${label} row ${i} (id=${row.id}): prevHash=${row.prevHash} but expected ${expectedPrev}`
      );
    }

    const canonical = rebuildCanonical(row);
    const recomputed = createHash('sha256').update(canonical).digest('hex');
    if (recomputed !== row.eventHash) {
      fail(`${label} row ${i} (id=${row.id}): eventHash mismatch — chain tampered or canonical drift`);
    }

    if (row.signature === null) fail(`${label} row ${i}: signature is null in enforce mode`);
    if (row.signatureKeyId === 'unsigned') fail(`${label} row ${i}: signatureKeyId='unsigned'`);
    if (!verifyAgentEvent(canonical, row.signature, publicKeyPem)) {
      fail(`${label} row ${i} (id=${row.id}): signature verification failed`);
    }

    expectedPrev = row.eventHash;
  }

  console.log(`  ✓ ${label}: ${rows.length} rows, chain + signatures all verify`);
}

async function runSequential(workflowId: string, count: number): Promise<string[]> {
  console.log(`\n[sequential] writing ${count} events to workflow ${workflowId}…`);
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const ev = await logAgentEvent({
      workflowId,
      agent: 'chain-test',
      action: 'sequential',
      data: { i, marker: 'pr2-chain-test' },
    });
    if (!ev) fail(`sequential write ${i} returned null`);
    ids.push(ev.id);
  }
  return ids;
}

async function runParallel(workflowId: string, count: number): Promise<string[]> {
  console.log(`\n[parallel] writing ${count} events concurrently to workflow ${workflowId}…`);
  const results = await Promise.all(
    Array.from({ length: count }, (_unused, i) =>
      logAgentEvent({
        workflowId,
        agent: 'chain-test',
        action: 'parallel',
        data: { i, marker: 'pr2-chain-test' },
      })
    )
  );
  const ids: string[] = [];
  for (const ev of results) {
    if (!ev) fail('parallel write returned null — serializable retry budget likely exhausted');
    ids.push(ev.id);
  }
  return ids;
}

async function readByIds(ids: string[]): Promise<ChainRow[]> {
  const rows = await prisma.agentEvent.findMany({
    where: { id: { in: ids } },
    orderBy: { timestamp: 'asc' },
  });
  return rows as ChainRow[];
}

async function cleanup(allIds: string[]): Promise<void> {
  await prisma.agentEvent.deleteMany({ where: { id: { in: allIds } } });
}

async function main() {
  await setupSigningEnv();
  const workflowId = await pickWorkflowId();

  const keyset = getKeyset();
  if (!keyset.current) fail('getKeyset() returned no current key');
  const publicKeyPem = keyset.current.publicKey;

  const seqIds = await runSequential(workflowId, 100);
  const seqRows = await readByIds(seqIds);
  verifyChain(seqRows, publicKeyPem, '100-sequential');

  const parIds = await runParallel(workflowId, 10);
  const parRows = await readByIds(parIds);
  verifyChain(parRows, publicKeyPem, '10-parallel');

  console.log('\n[cleanup] removing the 110 test events…');
  await cleanup([...seqIds, ...parIds]);

  console.log('\n✓ All chain + signature checks passed.');
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error('UNHANDLED ERROR:', err);
  await prisma.$disconnect().catch(() => undefined);
  process.exit(1);
});
