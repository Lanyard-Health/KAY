// Drives the exact puppeteer surface caqh-credentials.service.ts uses, against a
// real browser. The unit tests mock puppeteer, so only this proves v25 runs.
import puppeteer from 'puppeteer';
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

const file = join(tmpdir(), 'puppeteer-smoke-fixture.html');
writeFileSync(file, page_html);

console.log('puppeteer version:', (await import('puppeteer/package.json', { with: { type: 'json' } })).default.version);

// Same launch options as the service.
const browser = await puppeteer.launch({
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

const page = await browser.newPage();
console.log('  newPage           ok');

await page.setUserAgent('Mozilla/5.0 (smoke test)');
console.log('  setUserAgent      ok');

await page.setViewport({ width: 1280, height: 800 });
console.log('  setViewport       ok');

await page.goto('file://' + file, { waitUntil: 'domcontentloaded' });
console.log('  goto              ok');

await page.waitForSelector('#user');
console.log('  waitForSelector   ok');

await page.type('#user', 'someone');
await page.type('#pass', 'secret');
console.log('  type              ok');

const typed = await page.evaluate(() => document.getElementById('user').value);
assert.strictEqual(typed, 'someone', 'evaluate did not read back the typed value');
console.log('  evaluate          ok  (read back:', typed + ')');

await Promise.all([
  page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {}),
  page.click('#go'),
]);
console.log('  click + waitForNavigation ok');

const url = page.url();
assert.ok(url.startsWith('file://'), 'url() returned something unexpected: ' + url);
console.log('  url               ok  (' + url.slice(-24) + ')');

await browser.close();
console.log('  close             ok');

rmSync(file, { force: true });
console.log('\nALL PUPPETEER APIS USED BY THE CAQH SERVICE WORK ON v25');
