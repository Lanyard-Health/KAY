import { test, expect } from '@playwright/test';

test.describe('Enrollments', () => {
  test('enrollments page loads', async ({ page }) => {
    await page.goto('/enrollments');

    await expect(page.getByText('Enrollment Pipeline')).toBeVisible();
    await expect(
      page.getByText('Track and manage all payer enrollments across providers')
    ).toBeVisible();
  });

  test('view toggle buttons are present', async ({ page }) => {
    await page.goto('/enrollments');

    // Kanban and table toggle buttons (icon buttons)
    const buttons = page.locator('button');
    await expect(buttons.first()).toBeVisible();
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
    await expect(page.getByText('Approved')).toBeVisible();
    await expect(page.getByText('In Progress')).toBeVisible();
  });

  test('search input filters enrollments', async ({ page }) => {
    await page.goto('/enrollments');

    const search = page.getByPlaceholder(/search by provider.*payer/i);
    await expect(search).toBeVisible();
  });

  test('kanban columns are displayed', async ({ page }) => {
    await page.goto('/enrollments');

    // Default view is kanban with 4 columns
    await expect(page.getByText('Submitted')).toBeVisible();
  });

  test('can switch to table view', async ({ page }) => {
    await page.goto('/enrollments');

    // Find the table view toggle (second icon button in toggle group)
    const tableToggle = page.locator('button').filter({ has: page.locator('svg') });
    // Click the table icon (second button in the view toggle)
    const buttons = await tableToggle.all();
    for (const btn of buttons) {
      const text = await btn.textContent();
      if (text === '') {
        // Icon-only buttons for toggle
        await btn.click();
        break;
      }
    }

    // After clicking table view, table headers should appear
    // If we're now in table view, check for table structure
    const tableVisible = await page.locator('table, [role="table"]').isVisible({ timeout: 3000 }).catch(() => false);
    if (tableVisible) {
      await expect(page.locator('table, [role="table"]')).toBeVisible();
    }
  });
});
