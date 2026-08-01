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

// NOTE: Playwright records at CSS viewport resolution no matter the deviceScaleFactor
// (a 4K recordVideo size just letterboxes the 1080p frames). Zoom headroom comes from
// the build instead: takes render into a 1600x900 card, so pushes up to ~1.2x stay sharp.
const VIEWPORT = { width: 1920, height: 1080 };
const only = process.argv.slice(2).map(Number);
const wants = (n) => only.length === 0 || only.includes(n);

const browser = await chromium.launch({ slowMo: 120 });

// Fake cursor: Playwright's real cursor is never drawn in recordings, so we add a
// visible one that glides (CSS transition) and ripples on click.
const CURSOR_JS = `(() => {
  if (window.__fakeCursor) return; window.__fakeCursor = true;
  const style = document.createElement('style');
  style.textContent = '#__cur{position:fixed;z-index:2147483647;pointer-events:none;' +
    'width:26px;height:26px;border-radius:50%;background:rgba(10,61,46,0.85);' +
    'border:2.5px solid #fff;box-shadow:0 2px 10px rgba(0,0,0,0.35);' +
    'transform:translate(-50%,-50%);left:-100px;top:-100px;' +
    'transition:left .22s cubic-bezier(.22,1,.36,1),top .22s cubic-bezier(.22,1,.36,1),width .15s,height .15s;}' +
    '.__rip{position:fixed;z-index:2147483646;pointer-events:none;width:26px;height:26px;' +
    'border-radius:50%;border:3px solid rgba(10,61,46,0.7);transform:translate(-50%,-50%);' +
    'animation:__ripA .55s ease-out forwards;}' +
    '@keyframes __ripA{to{transform:translate(-50%,-50%) scale(3.2);opacity:0;}}';
  const c = document.createElement('div');
  c.id = '__cur';
  const mount = () => { document.head.appendChild(style); document.body.appendChild(c); };
  document.body ? mount() : document.addEventListener('DOMContentLoaded', mount);
  document.addEventListener('mousemove', e => { c.style.left = e.clientX + 'px'; c.style.top = e.clientY + 'px'; }, true);
  document.addEventListener('mousedown', e => {
    const r = document.createElement('div'); r.className = '__rip';
    r.style.left = e.clientX + 'px'; r.style.top = e.clientY + 'px';
    document.body.appendChild(r); setTimeout(() => r.remove(), 600);
    c.style.width = '19px'; c.style.height = '19px';
    setTimeout(() => { c.style.width = '26px'; c.style.height = '26px'; }, 160);
  }, true);
})()`;

// Dim everything except one element for a moment (Teamble-style focus)
async function spotlight(page, locator, ms = 2600) {
  const box = await locator.boundingBox().catch(() => null);
  if (!box) return;
  await page.evaluate(({ box, ms }) => {
    const pad = 10;
    const o = document.createElement('div');
    o.style.cssText = 'position:fixed;inset:0;z-index:2147483000;pointer-events:none;transition:opacity .4s;opacity:0';
    o.innerHTML = `<div style="position:fixed;left:${box.x - pad}px;top:${box.y - pad}px;` +
      `width:${box.width + 2 * pad}px;height:${box.height + 2 * pad}px;border-radius:12px;` +
      'box-shadow:0 0 0 9999px rgba(7,32,24,0.45);"></div>';
    document.body.appendChild(o);
    requestAnimationFrame(() => { o.style.opacity = '1'; });
    setTimeout(() => { o.style.opacity = '0'; setTimeout(() => o.remove(), 450); }, ms);
  }, { box, ms });
  await page.waitForTimeout(ms + 500);
}

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
  await ctx.addInitScript(CURSOR_JS);
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

// ── Tour scenes (10-15): portal-tour.json, the 2-minute product tour ────────

// a camera-ready in-progress enrollment (editable payer, notes writable)
const TOUR_ENR = execSync(`docker exec credentials-db psql -U credentials credentials -t -c "SELECT e.id FROM payer_enrollments e JOIN providers pr ON pr.id=e.provider_id WHERE pr.practice_id='${execSync(`docker exec credentials-db psql -U credentials credentials -t -c "SELECT id FROM practices WHERE name='Brightpath Behavioral Health';"`).toString().trim()}' AND e.status='in_progress' ORDER BY e.updated_at DESC LIMIT 1;"`)
  .toString().trim();

// ── Scene 10: tour-login (~11s) — the real prod login page (public, no data) ─
if (wants(10)) await record('tour-login', undefined, async (page) => {
  await page.goto('https://portal.lanyardhealth.com/login');
  await page.waitForTimeout(3500);
  await page.getByPlaceholder('Enter your email').click();
  await page.keyboard.type('hello@lanyardhealth.com', { delay: 70 });
  await page.waitForTimeout(1500);
  await page.getByText('Forgot your password?').click();
  await page.waitForTimeout(2500);
});

// ── Scene 11: tour-pipeline (~18s) — board, then SPA-click into a detail ────
if (wants(11)) await record('tour-pipeline', adminState, async (page) => {
  await page.goto(`${BASE}/enrollments`);
  await page.waitForTimeout(3500);
  await drift(page, 150);
  await page.waitForTimeout(2500);
  const card = page.locator(`a[href="/enrollments/${TOUR_ENR}"]`).first();
  if (await card.count()) { await card.click(); }
  else { await page.locator('a[href^="/enrollments/"]').first().click(); }
  await page.waitForTimeout(3200);
  await drift(page, 380);
  await page.waitForTimeout(2500);
  await drift(page, 120);
  await page.waitForTimeout(1800);
});

// ── Scene 12: tour-edit (~18s) — edit modal + Stedi payer combobox ──────────
if (wants(12)) await record('tour-edit', adminState, async (page) => {
  await page.goto(`${BASE}/enrollments/${TOUR_ENR}`);
  await page.waitForTimeout(3200);
  await page.getByRole('button', { name: 'Edit' }).first().click();
  await page.waitForTimeout(2200);
  await page.locator('#edit-enrollment-payer').click();
  await page.waitForTimeout(800);
  await page.keyboard.type('cigna', { delay: 160 });
  await page.waitForTimeout(1400); // catalog dropdown visible
  await spotlight(page, page.locator('#edit-enrollment-payer'), 2400);
  await page.keyboard.press('Escape'); // close dropdown, keep modal
  await page.waitForTimeout(2000);
  await page.getByRole('button', { name: 'Cancel' }).click();
  await page.waitForTimeout(3000);
});

// ── Scene 13: tour-notes (~13s) — timestamped, authored notes ───────────────
if (wants(13)) await record('tour-notes', adminState, async (page) => {
  await page.goto(`${BASE}/enrollments/${TOUR_ENR}`);
  await page.waitForTimeout(3000);
  const box = page.getByPlaceholder(/Add a note for this enrollment/); // unicode ellipsis in the real placeholder
  await box.scrollIntoViewIfNeeded();
  await page.waitForTimeout(800);
  await box.click();
  await page.keyboard.type('Called the payer. Application is in final review.', { delay: 42 });
  await page.waitForTimeout(600);
  await page.getByRole('button', { name: 'Add note' }).click();
  await page.waitForTimeout(3500); // note lands in the feed
});

// ── Scene 14: tour-practice (~19s) — NPPES lookup by name, confirm, fill ────
if (wants(14)) await record('tour-practice', adminState, async (page) => {
  await page.goto(`${BASE}/practices`);
  await page.waitForTimeout(2800);
  await page.getByRole('button', { name: /Add Practice/i }).first().click();
  await page.waitForTimeout(1800);
  await page.getByText(/Search by name/i).click();
  await page.waitForTimeout(1000);
  await page.getByPlaceholder(/Start of the name/i).click();
  await page.keyboard.type('behavioral break', { delay: 75 });
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await page.waitForTimeout(2500); // live registry results
  await page.locator('button', { hasText: /Behavioral Break/i }).first().click();
  await page.waitForTimeout(1800); // green verified panel
  await page.getByRole('button', { name: /Use this info/i }).click();
  await page.waitForTimeout(1200);
  await drift(page, 0);
  await page.waitForTimeout(2200); // form filled from the registry
  await drift(page, 260, 18);
  await page.waitForTimeout(3600); // narration mentions inviting the team
});

// ── Scene 15: tour-dashboard (~16.5s) — practice transparency view ──────────
if (wants(15)) await record('tour-dashboard', practiceState, async (page) => {
  await page.goto(`${BASE}/`);
  await page.waitForTimeout(3000);
  await drift(page, 420);
  await page.waitForTimeout(1800);
  await drift(page, 1050);
  await page.waitForTimeout(2400);
  await drift(page, 1750);
  await page.waitForTimeout(2200);
});

// ── Automation scenes (16-18): lanyard-automation / -preview specs ──────────

// ── Scene 16: auto-caqh (~20s) — provider self-signup, then the imported profile
if (wants(16)) await record('auto-caqh', adminState, async (page) => {
  // Beat 1: the public registration form (NPI + CAQH ID, nothing else typed)
  await page.goto(`${BASE}/register`);
  await page.waitForTimeout(2200);
  // 9 digits on purpose: a 10th digit triggers the live NPPES lookup, which
  // would flash "NPI not found" for a synthetic number
  await page.getByPlaceholder('10-digit NPI number').click();
  await page.keyboard.type('991122334', { delay: 65 });
  await page.waitForTimeout(600);
  await drift(page, 620, 18); // down to the CAQH Provider ID field
  await page.getByPlaceholder('Usually 8 digits').click();
  await page.keyboard.type('84210976', { delay: 70 });
  await spotlight(page, page.getByPlaceholder('Usually 8 digits'), 2000); // import-on-approval copy
  // Beat 2: what approval unlocks — the fully imported provider profile
  await page.goto(`${BASE}/providers/${WHITFIELD}`);
  await page.waitForTimeout(3200);
  await drift(page, 320); // CAQH ProView card
  await page.waitForTimeout(2000);
  await drift(page, 1050, 28); // licenses, work history, malpractice
  await page.waitForTimeout(2400);
  await drift(page, 1650, 24);
  await page.waitForTimeout(2200);
});

// ── Scene 17: auto-reattest (~15s) — expiration tracking tiles + table ──────
if (wants(17)) await record('auto-reattest', adminState, async (page) => {
  await page.goto(`${BASE}/expirations`);
  await page.waitForTimeout(3800);
  await drift(page, 220, 18);
  await page.waitForTimeout(4200);
  await drift(page, 0, 14);
  await page.waitForTimeout(4500);
});

// ── Scene 18: auto-preview (~17s) — agent workflows w/ EARLY PREVIEW banner ─
if (wants(18)) await record('auto-preview', adminState, async (page) => {
  await page.goto(`${BASE}/admin/workflows`);
  // honesty label baked into the footage — this feature is not production-ready
  await page.evaluate(() => {
    const b = document.createElement('div');
    b.textContent = 'EARLY PREVIEW · IN DEVELOPMENT';
    b.style.cssText = 'position:fixed;top:84px;left:50%;transform:translateX(-50%);z-index:99999;background:#92400e;color:#fef3c7;font:600 15px/1 -apple-system,Helvetica,sans-serif;letter-spacing:1.5px;padding:10px 22px;border-radius:999px;box-shadow:0 4px 14px rgba(0,0,0,0.25);';
    document.body.appendChild(b);
  });
  await page.waitForTimeout(3600);
  const row = page.getByText('Complete payer enrollment with Aetna').first();
  await row.hover();
  await page.waitForTimeout(3400);
  await page.getByText('waiting approval').first().hover();
  await page.waitForTimeout(4200);
  await page.getByRole('button', { name: /In flight/i }).hover().catch(() => {});
  await page.waitForTimeout(3800);
});

// ── Scene 19: tour-chat (~16s) — ask the assistant what to prioritize ───────
if (wants(19)) await record('tour-chat', adminState, async (page) => {
  await page.goto(`${BASE}/ai-agent?tab=chat`);
  await page.waitForTimeout(2600);
  await page.getByPlaceholder('Ask about enrollments, credentials, providers...').click();
  await page.keyboard.type('What should I prioritize today?', { delay: 55 });
  await page.waitForTimeout(500);
  const answer = page.waitForResponse(r => r.url().includes('/ai/chat') && r.ok(), { timeout: 60000 });
  await page.keyboard.press('Enter');
  await answer; // typing indicator on camera while the model works
  await page.waitForTimeout(2500); // answer renders (auto-scrolled to its end)
  await page.mouse.move(960, 480); // wheel target: the messages area
  await page.mouse.wheel(0, -900); // back up to the top of the answer
  await page.waitForTimeout(2400);
  await page.mouse.wheel(0, 400);
  await page.waitForTimeout(2200);
  await page.mouse.wheel(0, 450);
  await page.waitForTimeout(1200);
  await spotlight(page, page.locator('.justify-start').last(), 2400); // the assistant's answer bubble
});

// ── Scene 20: practice-signup (~15s) — public self-serve practice signup ────
if (wants(20)) await record('practice-signup', adminState, async (page) => {
  await page.goto(`${BASE}/practice-signup`);
  await page.waitForTimeout(2600);
  await page.getByText("I'm the practice owner").click();
  await page.waitForTimeout(1800); // form unfolds
  await drift(page, 260, 18);
  await page.getByPlaceholder('Your practice name').click();
  await page.keyboard.type('Sunrise Counseling Group', { delay: 60 });
  await page.waitForTimeout(700);
  await page.getByPlaceholder('First', { exact: true }).click();
  await page.keyboard.type('Dana', { delay: 70 });
  await page.waitForTimeout(600);
  await page.getByPlaceholder('you@practice.com').click();
  await page.keyboard.type('dana@sunrisecounseling.example', { delay: 45 });
  await page.waitForTimeout(2200); // hold on the filling form; no password typed on camera
});

await browser.close();
console.log('all takes done →', OUT);
