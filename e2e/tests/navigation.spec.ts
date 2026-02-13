import { test, expect } from '@playwright/test';

const navItems = [
  { name: 'Dashboard', path: '/' },
  { name: 'Providers', path: '/providers' },
  { name: 'Practices', path: '/practices' },
  { name: 'Users', path: '/users' },
  { name: 'Enrollments', path: '/enrollments' },
  { name: 'Documents', path: '/documents' },
  { name: 'Expirations', path: '/expirations' },
  { name: 'Roster', path: '/roster' },
  { name: 'AI Agent', path: '/ai-agent' },
  { name: 'Payer Intelligence', path: '/payer-intelligence' },
  { name: 'Pending Providers', path: '/pending-providers' },
  { name: 'Onboarding', path: '/onboarding-progress' },
];

test.describe('Sidebar Navigation', () => {
  test('all nav items are visible', async ({ page }) => {
    await page.goto('/');

    for (const item of navItems) {
      await expect(page.getByRole('link', { name: item.name })).toBeVisible();
    }
  });

  for (const item of navItems) {
    test(`navigates to ${item.name}`, async ({ page }) => {
      await page.goto('/');

      await page.getByRole('link', { name: item.name }).click();
      await expect(page).toHaveURL(item.path);
    });
  }
});
