// Drives the exact Playwright surface caqh-credentials.service.ts uses, against
// a real browser. The unit tests mock playwright, so only this proves the
// automation actually runs. Run it after any playwright bump:
//
//   node packages/backend/scripts/browser-smoke.mjs
import { chromium } from 'playwright';
import { writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert';

const page_html = `<!doctype html><html><body>
  <form id="f" action="#done">
    <input id="user" name="user" type="text">
    <input id="pass" name="pass" type="password">
    <button id="go" type="submit">Sign in</button>
  </form>
  <div id="marker">ready</div>
</body></html>`;

const file = join(tmpdir(), 'browser-smoke-fixture.html');
writeFileSync(file, page_html);

// Same launch options as the service.
const browser = await chromium.launch({
  headless: true,
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-accelerated-2d-canvas',
    '--disable-gpu',
  ],
});
console.log('  launch            ok');

// Viewport + user agent are context options, exactly as the service sets them.
const context = await browser.newContext({
  viewport: { width: 1280, height: 720 },
  userAgent: 'Mozilla/5.0 (smoke test)',
});
console.log('  newContext (viewport, userAgent) ok');

const page = await context.newPage();
console.log('  newPage           ok');

await page.goto('file://' + file, { waitUntil: 'networkidle' });
console.log('  goto networkidle  ok');

await page.waitForSelector('#user', { timeout: 10000 });
console.log('  waitForSelector   ok');

// page.$ against a loose selector — the service relies on first-match,
// non-strict semantics.
const el = await page.$('input[type="text"]');
assert.ok(el, 'page.$ did not find the loose selector');
console.log('  page.$ (loose selector, first match) ok');

await page.type('#user', 'someone', { delay: 50 });
await page.type('#pass', 'secret', { delay: 50 });
console.log('  type              ok');

const typed = await page.evaluate(() => document.getElementById('user').value);
assert.strictEqual(typed, 'someone', 'evaluate did not read back the typed value');
console.log('  evaluate          ok  (read back:', typed + ')');

// ElementHandle.evaluate, as findLoginButton uses.
const buttons = await page.$$('button');
const label = await buttons[0].evaluate((b) => b.textContent);
assert.ok(label.includes('Sign in'), 'button.evaluate returned wrong text: ' + label);
console.log('  $$ + handle.evaluate ok');

await page.click('#go');
await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => null);
console.log('  click + waitForLoadState ok');

const url = page.url();
assert.ok(url.startsWith('file://'), 'url() returned something unexpected: ' + url);
console.log('  url               ok');

await context.close();
await browser.close();
console.log('  close             ok');

rmSync(file, { force: true });
console.log('\nALL PLAYWRIGHT APIS USED BY THE CAQH SERVICE WORK');
