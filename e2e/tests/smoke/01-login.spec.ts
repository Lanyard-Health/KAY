import { test, expect } from '@playwright/test';

/**
 * Smoke: login flow.
 * Dev-bypass admin login → dashboard renders.
 * Uses no saved auth (this is the entry to the suite — every other test
 * runs against saved storage from auth.setup.ts).
 */
test.describe('Smoke — Login', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('dev admin login lands on dashboard', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();

    await page.getByRole('button', { name: 'Login as Dev Admin' }).click();

    await page.waitForURL('/', { timeout: 15000 });
    await expect(page.getByText('Welcome to Lanyard Health')).toBeVisible({ timeout: 10000 });
  });
});
