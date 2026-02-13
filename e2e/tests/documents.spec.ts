import { test, expect } from '@playwright/test';

test.describe('Documents', () => {
  test('documents page loads', async ({ page }) => {
    await page.goto('/documents');

    await expect(page.getByText('Documents')).toBeVisible();
    await expect(
      page.getByText('Manage provider documents, licenses, and certificates')
    ).toBeVisible();
  });

  test('provider selector is present', async ({ page }) => {
    await page.goto('/documents');

    const selector = page.getByText(/select provider|choose a provider/i);
    await expect(selector).toBeVisible();
  });

  test('selecting a provider shows document section', async ({ page }) => {
    await page.goto('/documents');

    // Open provider dropdown and select first option
    const dropdown = page.locator('select, [role="combobox"], [role="listbox"]').first();
    if (await dropdown.isVisible({ timeout: 5000 }).catch(() => false)) {
      // Select the first non-placeholder option
      const options = dropdown.locator('option');
      const count = await options.count();
      if (count > 1) {
        await dropdown.selectOption({ index: 1 });

        // Upload button should appear
        await expect(
          page.getByRole('button', { name: /upload document/i })
        ).toBeVisible({ timeout: 5000 });
      }
    }
  });

  test('upload button opens modal', async ({ page }) => {
    await page.goto('/documents');

    // Select a provider first
    const dropdown = page.locator('select').first();
    if (await dropdown.isVisible({ timeout: 5000 }).catch(() => false)) {
      const options = dropdown.locator('option');
      const count = await options.count();
      if (count > 1) {
        await dropdown.selectOption({ index: 1 });

        const uploadBtn = page.getByRole('button', { name: /upload document/i });
        if (await uploadBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
          await uploadBtn.click();

          // Modal should appear with document type selector
          await expect(
            page.getByText(/document type|select.*type/i)
          ).toBeVisible({ timeout: 5000 });

          // Close modal
          const closeButton = page.getByRole('button', { name: /close|cancel/i }).first();
          if (await closeButton.isVisible()) {
            await closeButton.click();
          }
        }
      }
    }
  });
});
