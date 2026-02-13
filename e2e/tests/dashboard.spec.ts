import { test, expect } from '@playwright/test';

test.describe('Dashboard', () => {
  test('dashboard heading is visible', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('Welcome to Lanyard Health')).toBeVisible();
  });

  test('stat cards render', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByText('Total Providers')).toBeVisible();
    await expect(page.getByText('Active')).toBeVisible();
    await expect(page.getByText('Pending')).toBeVisible();
    await expect(page.getByText('Needs Attention')).toBeVisible();
  });

  test('quick action: Add Provider navigates correctly', async ({ page }) => {
    await page.goto('/');

    await page.getByText('Add Provider').click();
    await expect(page).toHaveURL('/providers/new');
  });

  test('quick action: Upload Document navigates correctly', async ({ page }) => {
    await page.goto('/');

    await page.getByText('Upload Document').click();
    await expect(page).toHaveURL('/documents');
  });

  test('quick action: New Enrollment navigates correctly', async ({ page }) => {
    await page.goto('/');

    await page.getByText('New Enrollment').click();
    await expect(page).toHaveURL('/enrollments');
  });

  test('action items section renders', async ({ page }) => {
    await page.goto('/');

    // The dashboard shows either action items or "all caught up" message
    const hasActionItems = await page.getByText(/item.*that need|attention/i).isVisible();
    const allCaughtUp = await page.getByText(/all caught up/i).isVisible();

    expect(hasActionItems || allCaughtUp).toBeTruthy();
  });
});
