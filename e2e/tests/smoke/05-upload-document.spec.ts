import { test, expect } from '@playwright/test';

/**
 * Smoke: admin can reach the documents page.
 *
 * Upload itself depends on S3 / LocalStack; a full upload-and-list flow
 * is too brittle for smoke. The documents list page being reachable +
 * showing the page chrome catches route-level regressions on the
 * document-management surface.
 */
test.describe('Smoke — Document upload (list reachable)', () => {
  test('documents page loads', async ({ page }) => {
    await page.goto('/documents');
    await expect(page.locator('main')).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible({ timeout: 10000 });
  });
});
