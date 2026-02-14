import { test, expect } from '@playwright/test';

test.describe('Dashboard', () => {
  test('dashboard heading is visible', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('Welcome to Lanyard Health')).toBeVisible();
  });

  test('stat cards render', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByText('Total Providers')).toBeVisible();
    // Use stat card labels which are unique (not matching status badges)
    await expect(page.getByText('Needs Attention')).toBeVisible();
  });

  test('quick action: Add Provider navigates correctly', async ({ page }) => {
    await page.goto('/');

    await page.getByRole('link', { name: /Add Provider/i }).click();
    await expect(page).toHaveURL('/providers/new');
  });

  test('quick action: Upload Document navigates correctly', async ({ page }) => {
    await page.goto('/');

    await page.getByRole('link', { name: /Upload Document/i }).click();
    await expect(page).toHaveURL('/documents');
  });

  test('quick action: New Enrollment navigates correctly', async ({ page }) => {
    await page.goto('/');

    await page.getByRole('link', { name: /New Enrollment/i }).click();
    await expect(page).toHaveURL('/enrollments');
  });

  test('action items section renders', async ({ page }) => {
    await page.goto('/');

    // Dashboard shows either "X items that need attention" or action item sections
    const hasAttentionText = await page.getByText(/items that need attention/i).isVisible().catch(() => false);
    const hasIncompleteProfiles = await page.getByText('Incomplete Profiles').isVisible().catch(() => false);
    const hasExpiringSoon = await page.getByText('Expiring Soon').isVisible().catch(() => false);

    expect(hasAttentionText || hasIncompleteProfiles || hasExpiringSoon).toBeTruthy();
  });
});
