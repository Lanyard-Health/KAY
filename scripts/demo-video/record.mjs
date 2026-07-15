/**
 * Demo-video scene recorder (local dev only).
 * Prereq: seed-demo-video.ts has been run; frontend on :5190.
 *
 * Logs in via the DEV bypass buttons in a throwaway context (never recorded),
 * saves storageState, then records each scene in a fresh authenticated context
 * so no login chrome appears on camera. One .webm per scene.
 *
 * Usage: node scripts/demo-video/record.mjs [sceneNumber ...]
 *   WHITFIELD_ID=<uuid> node scripts/demo-video/record.mjs 3
 */
import { chromium } from 'playwright';
import { execSync } from 'node:child_process';
import fs from 'node:fs';

const BASE = 'http://localhost:5190';
const OUT = process.env.TAKES_DIR
  ?? '/private/tmp/claude-501/-Users-kaysworld/5c491e03-7585-45bd-a5cd-83371fb29405/scratchpad/takes';
fs.mkdirSync(OUT, { recursive: true });

const WHITFIELD = process.env.WHITFIELD_ID
  ?? execSync(`docker exec credentials-db psql -U credentials credentials -t -c "SELECT id FROM providers WHERE npi='9900000002';"`)
    .toString().trim();

const VIEWPORT = { width: 1280, height: 800 };
const only = process.argv.slice(2).map(Number);
const wants = (n) => only.length === 0 || only.includes(n);

const browser = await chromium.launch({ slowMo: 120 });

async function authState(devButton) {
  const ctx = await browser.newContext({ viewport: VIEWPORT });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`);
  await page.getByRole('button', { name: devButton }).click();
  await page.waitForTimeout(2500);
  const state = await ctx.storageState();
  await ctx.close();
  return state;
}

async function record(name, storageState, fn) {
  const ctx = await browser.newContext({
    viewport: VIEWPORT,
    storageState,
    recordVideo: { dir: OUT, size: VIEWPORT },
  });
  const page = await ctx.newPage();
  try {
    await fn(page);
  } finally {
    const video = page.video();
    await ctx.close();
    if (video) {
      const p = await video.path();
      fs.renameSync(p, `${OUT}/${name}.webm`);
      console.log(`take saved: ${name}.webm`);
    }
  }
}

// gentle scroll so the take reads as human
async function drift(page, toY, steps = 24) {
  const from = await page.evaluate(() => window.scrollY);
  for (let i = 1; i <= steps; i++) {
    await page.evaluate((y) => window.scrollTo(0, y), from + ((toY - from) * i) / steps);
    await page.waitForTimeout(45);
  }
}

const adminState = await authState('Login as Dev Admin');
const practiceState = await authState('Login as Dev Practice Admin');
const providerState = await authState('Login as Dev Provider');

// ── Scene 1: provider self-service onboarding wizard ───────────────────────
if (wants(1)) await record('scene1-portal', providerState, async (page) => {
  await page.goto(`${BASE}/portal`);
  await page.waitForTimeout(3000);
  await drift(page, 300);
  await page.waitForTimeout(1200);
  await page.getByRole('button', { name: 'Next' }).click(); // Profile → Documents
  await page.waitForTimeout(2600);
  await drift(page, 200);
  await page.waitForTimeout(1500);
});

// ── Scene 2: one-click approve ──────────────────────────────────────────────
if (wants(2)) await record('scene2-approve', adminState, async (page) => {
  await page.goto(`${BASE}/pending-providers`);
  await page.waitForTimeout(3000);
  // exact match — the "Approved" filter tab also matches /approve/i
  const approve = page.getByRole('button', { name: 'Approve', exact: true }).first();
  await approve.hover();
  await page.waitForTimeout(900);
  await approve.click();
  await page.waitForTimeout(1600); // dialog: "This will create their provider account."
  await page.getByRole('button', { name: 'Approve', exact: true }).last().click();
  await page.waitForTimeout(4000); // toast + row flips to approved
});

// ── Scene 3: CAQH import panel ──────────────────────────────────────────────
if (wants(3)) await record('scene3-caqh', adminState, async (page) => {
  await page.goto(`${BASE}/providers/${WHITFIELD}`);
  await page.waitForTimeout(3500);
  await drift(page, 260); // bring CAQH ProView card + import panel into view
  await page.waitForTimeout(1800);
  const history = page.getByText('View Sync History');
  if (await history.isVisible().catch(() => false)) {
    await history.click();
    await page.waitForTimeout(2800);
    await page.keyboard.press('Escape');
  }
  await page.waitForTimeout(1500);
});

// ── Scene 4: payer search + enrollment + live checklist ────────────────────
if (wants(4)) await record('scene4-enrollment', adminState, async (page) => {
  await page.goto(`${BASE}/enrollments`);
  await page.waitForTimeout(3000);
  await page.getByRole('button', { name: 'Add Enrollment' }).first().click();
  await page.waitForTimeout(1500);
  // scope to the modal form — the kanban board behind it has matching text
  const form = page.locator('form');
  await page.getByPlaceholder('Search providers by name or NPI...').pressSequentially('whitfield', { delay: 90 });
  await page.waitForTimeout(1400);
  await form.getByText('Sarah Whitfield').first().click();
  await page.waitForTimeout(1000);
  await page.getByPlaceholder('Search payers...').pressSequentially('georgia medicaid', { delay: 85 });
  await page.waitForTimeout(1600);
  await form.getByText('Medicaid Georgia').first().click();
  await page.waitForTimeout(1200);
  await page.getByRole('button', { name: 'Create Enrollment' }).click();
  await page.waitForTimeout(3000);
  // open the new enrollment to show the instantiated checklist
  // match by payer NAME — the search can resolve to any payer row named Medicaid Georgia
  const id = execSync(`docker exec credentials-db psql -U credentials credentials -t -c "SELECT e.id FROM payer_enrollments e JOIN payers p ON p.id=e.payer_id WHERE e.provider_id='${WHITFIELD}' AND p.name='Medicaid Georgia' ORDER BY e.created_at DESC LIMIT 1;"`)
    .toString().trim();
  await page.goto(`${BASE}/enrollments/${id}`);
  await page.waitForTimeout(3200);
  await drift(page, 420);
  await page.waitForTimeout(2200);
});

// ── Scene 5a: practice transparency dashboard ───────────────────────────────
if (wants(5)) await record('scene5-dashboard', practiceState, async (page) => {
  await page.goto(`${BASE}/`);
  await page.waitForTimeout(3500);
  await drift(page, 420);   // tiles + charts
  await page.waitForTimeout(1600);
  await drift(page, 1050);  // status-dot grid
  await page.waitForTimeout(1800);
  await drift(page, 1750);  // in-flight ETA bars + attention panel
  await page.waitForTimeout(2400);
});

// ── Scene 6: attestation board + expiration forecast (admin dashboard) ─────
if (wants(6)) await record('scene6-attestation', adminState, async (page) => {
  await page.goto(`${BASE}/`);
  await page.waitForTimeout(3200);
  const bodyH = await page.evaluate(() => document.body.scrollHeight);
  await drift(page, bodyH, 30); // attestation board is the last widget
  await page.waitForTimeout(2600);
  await drift(page, Math.max(0, bodyH - 1500), 20); // back up to the expiration forecast
  await page.waitForTimeout(2400);
});

// ── Clip scenes: longer solo takes for the 30-45s pain clips ────────────────

// ── Scene 7: clip-caqh (~26s) — extended CAQH import tour ──────────────────
if (wants(7)) await record('clip-caqh', adminState, async (page) => {
  await page.goto(`${BASE}/providers/${WHITFIELD}`);
  await page.waitForTimeout(4000);
  await drift(page, 260); // CAQH ProView card + import panel
  await page.waitForTimeout(3200);
  const history = page.getByText('View Sync History');
  if (await history.isVisible().catch(() => false)) {
    await history.click();
    await page.waitForTimeout(4400); // linger on the sync log
    await page.keyboard.press('Escape');
  }
  await page.waitForTimeout(1500);
  await drift(page, 900, 30); // profile sections + documents pulled in
  await page.waitForTimeout(3600);
  await drift(page, 1500, 30);
  await page.waitForTimeout(4200);
});

// ── Scene 8: clip-dashboard (~25s) — extended practice dashboard tour ──────
if (wants(8)) await record('clip-dashboard', practiceState, async (page) => {
  await page.goto(`${BASE}/`);
  await page.waitForTimeout(3500);
  await page.waitForTimeout(1500); // hero tiles
  await drift(page, 420);
  await page.waitForTimeout(2200); // charts
  await drift(page, 1050);
  await page.waitForTimeout(4200); // status-dot grid (every provider x payer)
  await drift(page, 1750);
  await page.waitForTimeout(4200); // in-flight ETA bars + "Running long" flag
  await drift(page, 1950, 12);
  await page.waitForTimeout(4000); // attention panel: what Lanyard is doing
});

// ── Scene 9: clip-expirations (~21s) — attestation board + expirations page ─
if (wants(9)) await record('clip-expirations', adminState, async (page) => {
  await page.goto(`${BASE}/`);
  await page.waitForTimeout(3200);
  // stage the set: the dev-admin account has no practice link, so a few
  // practice-scoped widgets render empty locally — hide those placeholder
  // cards so the (real, populated) attestation board frames cleanly
  await page.evaluate(() => {
    document.querySelectorAll('div').forEach((el) => {
      const t = el.innerText || '';
      if (
        /No providers added yet|No enrollments yet|No credentials expiring/.test(t) &&
        !t.includes('CAQH Attestations') && t.length < 400
      ) el.style.display = 'none';
    });
  });
  await page.waitForTimeout(800);
  const bodyH = await page.evaluate(() => document.body.scrollHeight);
  await drift(page, bodyH, 30); // CAQH attestation board (last widget)
  await page.waitForTimeout(5200);
  await page.goto(`${BASE}/expirations`); // 7/30/90-day tiles + license table
  await page.waitForTimeout(4000);
  await drift(page, 250, 12);
  await page.waitForTimeout(4800);
});

await browser.close();
console.log('all takes done →', OUT);
