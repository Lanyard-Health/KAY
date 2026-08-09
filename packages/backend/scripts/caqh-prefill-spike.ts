/**
 * THROWAWAY SPIKE — CAQH registration-prefill feasibility.
 * Delete once the findings are recorded in the plan.
 *
 * Answers, against the CAQH DEMO environment only:
 *   0.2  Can we pullCredentials WITHOUT roster-adding first?   <- load-bearing
 *   0.3  Does mapCaqhToInternal() work with no providerId?
 *   0.5  How long do checkStatus + pullCredentials actually take?
 *   0.6  What does a bad/unknown CAQH ID return?
 *   0.7b Is the NPI field actually POPULATED (not just present in the shape)?
 *
 * READ-ONLY. Calls only GET endpoints (checkStatus, pullCredentials) and a
 * pure mapping function. Never calls addToRoster (mutates CAQH's roster) or
 * syncProvider (writes to our DB).
 *
 * Prints NO PII — booleans, lengths and counts only. Never the NPI/SSN/name.
 *
 * Usage:
 *   cd /Users/kaysworld/dev/KAY/packages/backend
 *   npx tsx scripts/caqh-prefill-spike.ts 16549008 [expectedNpi]
 */
import 'dotenv/config';
import { CaqhService } from '../src/services/caqh.service.js';

const caqhId = process.argv[2];
const expectedNpi = process.argv[3];

if (!caqhId) {
  console.error('usage: npx tsx scripts/caqh-prefill-spike.ts <caqhProviderId> [expectedNpi]');
  process.exit(1);
}

// Refuse to run against production CAQH. Demo POID is 6279; prod is 1873.
const url = process.env['CAQH_API_URL'] ?? '';
const org = process.env['CAQH_ORG_ID'] ?? '';
if (!url.includes('demo') || org !== '6279') {
  console.error(`REFUSING TO RUN — not the demo environment (url=${url} org=${org}). Expected a demo URL and org 6279.`);
  process.exit(1);
}

const ok = (b: boolean) => (b ? 'YES' : 'NO');

async function main() {
  const svc = new CaqhService();
  console.log(`env: ${url} org=${org}\ncaqhId: ${caqhId}\n`);

  // --- 0.5a + prerequisite for the pull: status ---
  let t = Date.now();
  const status = await svc.checkStatus(caqhId);
  const statusMs = Date.now() - t;
  console.log(`[0.5] checkStatus: ${statusMs}ms`);
  console.log(`      roster_status      = ${status.roster_status ?? '(none)'}`);
  console.log(`      authorization_flag = ${status.authorization_flag ?? '(none)'}`);

  const rawDate = status.provider_status_date || status.anniversary_date;
  if (!rawDate) {
    console.log('\n[0.2] STOP: no attestation date on the status response — cannot pull.');
    return;
  }

  // yyyymmddToMDYYYY is private; replicate the same transform here.
  const attestationDate = `${+rawDate.slice(4, 6)}/${+rawDate.slice(6, 8)}/${rawDate.slice(0, 4)}`;

  // --- 0.2: pull WITHOUT roster-add ---
  // Note: this only proves "no roster-add needed" if the provider is not
  // already on our roster. Check roster_status above when reading the result.
  t = Date.now();
  const raw = await svc.pullCredentials(caqhId, attestationDate);
  const pullMs = Date.now() - t;
  console.log(`\n[0.2] pullCredentials WITHOUT roster-add: SUCCEEDED (${pullMs}ms)`);
  console.log(`      (valid evidence only if roster_status above was NOT ON ROSTER)`);

  // --- 0.7b: is NPI actually populated? ---
  const p = (raw as Record<string, any>)?.Provider ?? {};
  const npiVal = p.NPI;
  const npiStr = npiVal == null ? '' : String(npiVal);
  console.log(`\n[0.7b] Provider.NPI present   = ${ok(npiStr !== '')}`);
  console.log(`       Provider.NPI length     = ${npiStr.length} (expect 10)`);
  if (expectedNpi) {
    console.log(`       matches expected NPI    = ${ok(npiStr === expectedNpi)}  <- the cross-check`);
  }

  // --- 0.3: map with NO providerId ---
  try {
    const mapped = svc.mapCaqhToInternal(raw);
    const counts = Object.entries(mapped as Record<string, any>)
      .map(([k, v]) => `${k}=${Array.isArray(v) ? v.length : v && typeof v === 'object' ? 'obj' : typeof v}`)
      .join(' ');
    console.log(`\n[0.3] mapCaqhToInternal(raw) with NO providerId: SUCCEEDED`);
    console.log(`      ${counts}`);
  } catch (e) {
    console.log(`\n[0.3] mapCaqhToInternal(raw) with NO providerId: FAILED`);
    console.log(`      ${e instanceof Error ? e.message : String(e)}`);
  }

  // --- 0.6: unknown/garbage ID ---
  try {
    const bad = await svc.checkStatus('99999999');
    console.log(`\n[0.6] unknown ID -> no throw. roster_status=${bad.roster_status ?? '(none)'}`);
  } catch (e) {
    console.log(`\n[0.6] unknown ID -> threw: ${e instanceof Error ? e.message : String(e)}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('\nSPIKE FAILED:', e instanceof Error ? e.message : e);
    process.exit(1);
  });
