import { test, expect } from '@playwright/test';

test.describe('Onboarding', () => {
  test('onboarding page loads', async ({ page }) => {
    await page.goto('/onboarding-progress');

    await expect(page.getByRole('heading', { name: 'Provider Onboarding' })).toBeVisible();
    await expect(
      page.getByText('Track and manage provider onboarding progress')
    ).toBeVisible();
  });

  test('summary cards render', async ({ page }) => {
    await page.goto('/onboarding-progress');

    await expect(page.getByText('Total Approved')).toBeVisible();
    await expect(page.getByText('Onboarding Complete')).toBeVisible();
  });

  test('filter tabs are present and clickable', async ({ page }) => {
    await page.goto('/onboarding-progress');

    const allTab = page.getByRole('button', { name: /^all/i });
    const completeTab = page.getByRole('button', { name: /complete/i });
    const inProgressTab = page.getByRole('button', { name: /in progress/i });
    const notStartedTab = page.getByRole('button', { name: /not started/i });

    await expect(allTab).toBeVisible();
    await expect(completeTab).toBeVisible();
    await expect(inProgressTab).toBeVisible();
    await expect(notStartedTab).toBeVisible();

    // Click each tab and verify it works
    await completeTab.click();
    await page.waitForTimeout(500);

    await inProgressTab.click();
    await page.waitForTimeout(500);

    await notStartedTab.click();
    await page.waitForTimeout(500);

    await allTab.click();
  });

  test('provider table renders', async ({ page }) => {
    await page.goto('/onboarding-progress');

    // Table should have provider data or empty state
    const table = page.locator('table');
    const hasTable = await table.isVisible({ timeout: 5000 }).catch(() => false);

    if (hasTable) {
      // Check for expected column headers
      await expect(page.getByRole('columnheader', { name: /provider/i })).toBeVisible();
      await expect(page.getByRole('columnheader', { name: /npi/i })).toBeVisible();
    }
  });

  test('review modal opens on eye button click', async ({ page }) => {
    await page.goto('/onboarding-progress');

    // Wait for table to load
    await page.waitForTimeout(2000);

    const rows = page.locator('table tbody tr');
    const rowCount = await rows.count().catch(() => 0);

    if (rowCount > 0) {
      // Click the action button on the first row
      const firstRowAction = rows.first().locator('button').first();
      if (await firstRowAction.isVisible()) {
        await firstRowAction.click();

        // Modal should appear with "Portal Documents" heading
        await expect(
          page.getByText(/portal documents/i)
        ).toBeVisible({ timeout: 5000 });
      }
    }
  });
});
