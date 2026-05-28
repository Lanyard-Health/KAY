import { test, expect } from '@playwright/test';

/**
 * Smoke: admin can reach the Add Provider form.
 * Runs under the admin-tests project which already has storage state
 * from auth.setup.ts, so we land authenticated.
 *
 * Asserts /providers/new is reachable and the form renders. A full
 * submit-and-list-the-new-provider path is too coupled to NPPES + DB
 * seed state for a smoke test.
 */
test.describe('Smoke — Add Provider', () => {
  test('admin can open the new provider form', async ({ page }) => {
    await page.goto('/providers/new');
    // The form is multi-step with NPI lookup as step 1. Catching the page
    // heading proves we got past the route guard and the lazy chunk loaded.
    await expect(page.locator('main')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Add New Provider' })).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Enter Provider NPI')).toBeVisible();
  });
});
