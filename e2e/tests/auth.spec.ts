import { test, expect } from '@playwright/test';

test.describe('Authentication', () => {
  test.use({ storageState: { cookies: [], origins: [] } }); // no saved auth

  test('login page renders correctly', async ({ page }) => {
    await page.goto('/login');

    // Green gradient background
    const body = page.locator('.bg-gradient-to-br');
    await expect(body).toBeVisible();

    // Logo
    const logo = page.locator('img[src="/logo.png"]');
    await expect(logo).toBeVisible();

    // Heading
    await expect(page.getByText('Sign in to your account')).toBeVisible();
  });

  test('dev mode section visible with both buttons', async ({ page }) => {
    await page.goto('/login');

    await expect(page.getByText('DEV MODE')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Login as Dev Admin' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Login as Dev Provider' })).toBeVisible();
  });

  test('login as dev admin redirects to dashboard', async ({ page }) => {
    await page.goto('/login');

    await page.getByRole('button', { name: 'Login as Dev Admin' }).click();

    await page.waitForURL('/', { timeout: 15000 });
    await expect(page.getByText('Welcome to Lanyard Health')).toBeVisible();
  });

  test('sidebar shows branding and nav items after login', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('button', { name: 'Login as Dev Admin' }).click();
    await page.waitForURL('/', { timeout: 15000 });

    await expect(page.getByText('Lanyard Health')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Dashboard' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Providers' })).toBeVisible();
  });

  test('sign out redirects to login', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('button', { name: 'Login as Dev Admin' }).click();
    await page.waitForURL('/', { timeout: 15000 });

    // Find and click sign out
    const signOutButton = page.getByRole('button', { name: /sign out|logout|log out/i });
    if (await signOutButton.isVisible()) {
      await signOutButton.click();
    } else {
      // May be in a user menu dropdown
      const userMenu = page.locator('[class*="user"], [class*="avatar"], [class*="profile"]').first();
      if (await userMenu.isVisible()) {
        await userMenu.click();
        await page.getByText(/sign out|logout|log out/i).click();
      }
    }

    await page.waitForURL('/login', { timeout: 10000 });
    await expect(page.getByText('Sign in to your account')).toBeVisible();
  });
});
