import { test, expect } from '@playwright/test';

test.describe('Practice Admin — Authenticated Experience', () => {
  // Uses practice-admin storage state from playwright.config.ts project

  test('sidebar shows only allowed navigation items', async ({ page }) => {
    await page.goto('/');

    const sidebar = page.locator('nav');

    // Should see these items
    await expect(sidebar.getByText('Dashboard')).toBeVisible();
    await expect(sidebar.getByText('Providers')).toBeVisible();
    await expect(sidebar.getByText('Enrollments')).toBeVisible();
    await expect(sidebar.getByText('Documents')).toBeVisible();
    await expect(sidebar.getByText('Expirations')).toBeVisible();

    // Should NOT see these items
    await expect(sidebar.getByText('Practices')).not.toBeVisible();
    await expect(sidebar.getByText('Users')).not.toBeVisible();
    await expect(sidebar.getByText('AI Agent')).not.toBeVisible();
    await expect(sidebar.getByText('Payer Intelligence')).not.toBeVisible();
    await expect(sidebar.getByText('Pending Providers')).not.toBeVisible();
    await expect(sidebar.getByText('Onboarding')).not.toBeVisible();
    await expect(sidebar.getByText('Roster')).not.toBeVisible();
  });

  test('dashboard loads successfully', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByText('Welcome to Lanyard Health')).toBeVisible({ timeout: 10000 });
  });

  test('can access providers page', async ({ page }) => {
    await page.goto('/providers');

    await expect(page).toHaveURL(/\/providers/);
    await expect(page.getByRole('heading', { name: 'Providers' })).toBeVisible({ timeout: 10000 });
  });

  test('can access enrollments page', async ({ page }) => {
    await page.goto('/enrollments');

    await expect(page).toHaveURL(/\/enrollments/);
    await expect(page.getByRole('heading', { name: 'Enrollment Pipeline' })).toBeVisible({ timeout: 10000 });
  });

  test('can access documents page', async ({ page }) => {
    await page.goto('/documents');

    await expect(page).toHaveURL(/\/documents/);
    await expect(page.getByRole('heading', { name: 'Documents' })).toBeVisible({ timeout: 10000 });
  });

  test('can access expirations page', async ({ page }) => {
    await page.goto('/expirations');

    await expect(page).toHaveURL(/\/expirations/);
    await expect(page.getByRole('heading', { name: 'Expiration Tracking' })).toBeVisible({ timeout: 10000 });
  });
});
