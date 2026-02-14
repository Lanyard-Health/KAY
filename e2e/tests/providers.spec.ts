import { test, expect } from '@playwright/test';

test.describe('Providers', () => {
  test('provider list page loads', async ({ page }) => {
    await page.goto('/providers');

    await expect(page.getByRole('heading', { name: 'Providers' })).toBeVisible();
    await expect(
      page.getByText('Manage healthcare provider credentials and information')
    ).toBeVisible();
  });

  test('search input is present', async ({ page }) => {
    await page.goto('/providers');

    const search = page.getByPlaceholder(/search by name/i);
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
    await expect(page.getByRole('heading', { name: /Enter Provider NPI/i })).toBeVisible();
    const npiInput = page.getByPlaceholder('1234567890');
    await expect(npiInput).toBeVisible();
    await expect(page.getByRole('button', { name: /lookup/i })).toBeVisible();
  });

  test('fill provider form and submit', async ({ page }) => {
    await page.goto('/providers/new');

    // Step 1: Enter NPI and click Next (skip lookup)
    const npiInput = page.getByPlaceholder('1234567890');
    await npiInput.fill('9999999001');
    await page.getByRole('button', { name: /next/i }).click();

    // Step 2: Fill provider info
    await expect(page.getByText('Provider Information')).toBeVisible({ timeout: 5000 });

    await page.getByPlaceholder('Enter first name').fill('E2E');
    await page.getByPlaceholder('Enter last name').fill('TestProvider');

    // Provider type (required)
    await page.locator('select').first().selectOption({ index: 1 });

    // Date of birth (required) — use the date input directly
    await page.locator('input[type="date"]').fill('1985-06-15');

    // Gender (required)
    await page.locator('select').nth(1).selectOption({ index: 1 });

    // Scroll down to fill email/phone (labels not associated via htmlFor, use input type)
    const emailInput = page.locator('input[type="email"]');
    await emailInput.scrollIntoViewIfNeeded();
    await emailInput.fill('e2e.test@example.com');

    const phoneInput = page.locator('input[type="tel"]').first();
    await phoneInput.scrollIntoViewIfNeeded();
    await phoneInput.fill('5555550199');

    // Submit — Step 2 goes directly to "Create Provider"
    const submitBtn = page.getByRole('button', { name: /create provider/i });
    await submitBtn.scrollIntoViewIfNeeded();
    await submitBtn.click();

    // Should redirect to provider detail
    await page.waitForURL(/\/providers\/[a-zA-Z0-9-]+$/, { timeout: 15000 });
  });

  test('provider detail page shows tabs', async ({ page }) => {
    // Navigate to providers list and click the first provider card
    await page.goto('/providers');

    // Wait for provider cards to load, then click the first card link
    const providerCard = page.locator('a[href*="/providers/"]').filter({ hasNotText: /add provider|new/i }).first();
    await expect(providerCard).toBeVisible({ timeout: 10000 });
    await providerCard.click();

    await page.waitForURL(/\/providers\/[a-zA-Z0-9-]+/, { timeout: 10000 });

    // Check for tab-like navigation on the detail page
    const mainContent = page.locator('main');
    await expect(mainContent.getByText('Overview')).toBeVisible({ timeout: 5000 });
  });
});
