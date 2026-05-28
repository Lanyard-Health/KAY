import { test, expect } from '@playwright/test';

/**
 * Smoke: admin can reach the enrollments list.
 *
 * "Submit enrollment" is a per-provider action buried in ProviderEnrollments.
 * The list page being reachable + showing the table chrome is enough to
 * catch a route-level regression. Going deeper would require fixtures and
 * an existing provider in the seed.
 */
test.describe('Smoke — Submit Enrollment (list reachable)', () => {
  test('enrollments page loads', async ({ page }) => {
    await page.goto('/enrollments');
    await expect(page.locator('main')).toBeVisible();
    // EnrollmentsList renders a heading + a status filter or empty state.
    // Asserting the heading + the page rendered is the right smoke check.
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible({ timeout: 10000 });
  });
});
