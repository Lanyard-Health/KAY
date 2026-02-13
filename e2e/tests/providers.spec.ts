import { test, expect } from '@playwright/test';

test.describe('Providers', () => {
  test('provider list page loads', async ({ page }) => {
    await page.goto('/providers');

    await expect(page.getByText('Providers')).toBeVisible();
    await expect(
      page.getByText('Manage healthcare provider credentials and information')
    ).toBeVisible();
  });

  test('search input is present', async ({ page }) => {
    await page.goto('/providers');

    const search = page.getByPlaceholder('Search by name, NPI, or email...');
    await expect(search).toBeVisible();
  });

  test('add provider button navigates to form', async ({ page }) => {
    await page.goto('/providers');

    await page.getByRole('link', { name: /Add Provider/i }).click();
    await expect(page).toHaveURL('/providers/new');
  });

  test('provider creation form wizard renders', async ({ page }) => {
    await page.goto('/providers/new');

    // Step 1: NPI Lookup
    await expect(page.getByText('NPI')).toBeVisible();
    const npiInput = page.getByPlaceholder('1234567890');
    await expect(npiInput).toBeVisible();
  });

  test('fill provider form and submit', async ({ page }) => {
    await page.goto('/providers/new');

    // Step 1: Enter NPI and continue
    const npiInput = page.getByPlaceholder('1234567890');
    await npiInput.fill('9999999001');

    // Click Continue/Next to go to step 2
    await page.getByRole('button', { name: /continue|next/i }).click();

    // Step 2: Fill provider info
    await page.getByLabel(/first name/i).fill('E2E');
    await page.getByLabel(/last name/i).fill('TestProvider');
    await page.getByLabel(/email/i).fill('e2e.test@example.com');
    await page.getByLabel(/^phone/i).fill('(555) 555-0199');

    // Select provider type
    const typeSelect = page.getByLabel(/provider type/i);
    await typeSelect.selectOption({ label: 'Psychiatrist' });

    // Date of birth
    await page.getByLabel(/date of birth/i).fill('1985-06-15');

    // Gender
    const genderSelect = page.getByLabel(/gender/i);
    await genderSelect.selectOption({ label: 'Male' });

    // Continue to step 3 (Documents)
    await page.getByRole('button', { name: /continue|next/i }).click();

    // Skip documents, continue to step 4 (Review)
    await page.getByRole('button', { name: /continue|next|skip/i }).click();

    // Submit
    await page.getByRole('button', { name: /create provider/i }).click();

    // Should redirect to provider detail
    await page.waitForURL(/\/providers\/[a-zA-Z0-9-]+$/, { timeout: 10000 });
  });

  test('provider detail page shows tabs', async ({ page }) => {
    // Navigate to providers list and click the first one
    await page.goto('/providers');

    // Wait for provider list to load
    const viewLink = page.getByRole('link', { name: /view/i }).first();
    if (await viewLink.isVisible({ timeout: 5000 }).catch(() => false)) {
      await viewLink.click();
    } else {
      // Try clicking a provider name/card
      const providerCard = page.locator('[class*="provider"], a[href*="/providers/"]').first();
      await providerCard.click();
    }

    await page.waitForURL(/\/providers\/[a-zA-Z0-9-]+/, { timeout: 10000 });

    // Check tabs
    await expect(page.getByText('Overview')).toBeVisible();
    await expect(page.getByText('Checklist')).toBeVisible();
    await expect(page.getByText('Enrollments')).toBeVisible();
    await expect(page.getByText('Tasks')).toBeVisible();
  });
});
