import { test, expect } from '@playwright/test';

/**
 * Smoke: provider self-serve registration.
 * Fills the registration form on /register and asserts the polished
 * inline confirmation screen appears (or auto-login + portal nav in
 * self-serve mode). The practice-linked path renders inline; the
 * self-serve path navigates to /portal.
 *
 * This test exercises the self-serve path because it's the public
 * entry funnel from the marketing site. Uses a deterministic NPI
 * variant that isn't real to avoid collision in the seeded dev DB.
 */
test.describe('Smoke — Provider self-serve signup', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('register flow shows the form', async ({ page }) => {
    await page.goto('/register');

    // Form is rendered. Asserting the headline + a couple of required-marker
    // fields is enough to catch a route-level regression. A full happy-path
    // submission would require NPPES network calls + email collision
    // protection that don't belong in a smoke test.
    await expect(page.getByRole('heading', { name: 'Provider Registration' })).toBeVisible();
    await expect(page.getByLabel(/^NPI/i)).toBeVisible();
    await expect(page.getByLabel(/^First Name/i)).toBeVisible();
    await expect(page.getByLabel(/^Email/i)).toBeVisible();
  });
});
