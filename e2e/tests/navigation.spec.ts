import { test, expect } from '@playwright/test';

const navItems = [
  { name: 'Dashboard', path: '/' },
  { name: 'Providers', path: '/providers' },
  { name: 'Practices', path: '/practices' },
  { name: 'Users', path: '/users' },
  { name: 'Enrollments', path: '/enrollments' },
  { name: 'Documents', path: '/documents' },
  { name: 'Tasks', path: '/tasks' },
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

    // Scope to the desktop sidebar to avoid matching mobile sidebar or page content
    const sidebar = page.locator('nav').first();

    for (const item of navItems) {
      await expect(sidebar.getByRole('link', { name: item.name, exact: true })).toBeVisible();
    }
  });

  for (const item of navItems) {
    test(`navigates to ${item.name}`, async ({ page }) => {
      await page.goto('/');

      // Scope to sidebar to avoid matching any page content links
      const sidebar = page.locator('nav').first();
      await sidebar.getByRole('link', { name: item.name, exact: true }).click();
      await expect(page).toHaveURL(item.path);
    });
  }
});
