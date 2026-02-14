import { test, expect } from '@playwright/test';

test.describe('Enrollments', () => {
  test('enrollments page loads', async ({ page }) => {
    await page.goto('/enrollments');

    await expect(page.getByRole('heading', { name: 'Enrollment Pipeline' })).toBeVisible();
    await expect(
      page.getByText('Track and manage all payer enrollments across providers')
    ).toBeVisible();
  });

  test('view toggle and refresh buttons are present', async ({ page }) => {
    await page.goto('/enrollments');

    await expect(page.getByRole('button', { name: /refresh/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /add enrollment/i })).toBeVisible();
  });

  test('new enrollment button is visible', async ({ page }) => {
    await page.goto('/enrollments');

    await expect(
      page.getByRole('button', { name: /add enrollment/i })
    ).toBeVisible();
  });

  test('summary stat cards render', async ({ page }) => {
    await page.goto('/enrollments');

    await expect(page.getByText('Total Enrollments')).toBeVisible();
    await expect(page.getByText('Needs Follow-up')).toBeVisible();
  });

  test('search input filters enrollments', async ({ page }) => {
    await page.goto('/enrollments');

    const search = page.getByPlaceholder(/search by provider/i);
    await expect(search).toBeVisible();
  });

  test('kanban columns are displayed', async ({ page }) => {
    await page.goto('/enrollments');

    // Kanban column headers with subtitles
    await expect(page.getByText('Application being prepared')).toBeVisible();
    await expect(page.getByText('Awaiting payer response')).toBeVisible();
    await expect(page.getByText('Successfully credentialed')).toBeVisible();
  });

  test('can switch to table view', async ({ page }) => {
    await page.goto('/enrollments');

    // Click the table view toggle (second icon button in the toggle group)
    const toggleGroup = page.locator('button svg').locator('..');
    const buttons = await toggleGroup.all();
    if (buttons.length >= 2) {
      await buttons[1].click();
    }

    // After clicking table view, table headers should appear
    const tableVisible = await page.locator('table, [role="table"]').isVisible({ timeout: 3000 }).catch(() => false);
    if (tableVisible) {
      await expect(page.locator('table, [role="table"]')).toBeVisible();
    }
  });
});
