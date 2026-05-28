import { test, expect } from '@playwright/test';

test.describe('Authentication', () => {
  test.use({ storageState: { cookies: [], origins: [] } }); // no saved auth

  test('login page renders correctly', async ({ page }) => {
    await page.goto('/login');

    // Green gradient background (animated, applied via .login-gradient-bg class)
    const body = page.locator('.login-gradient-bg');
    await expect(body).toBeVisible();

    // Logo — both desktop logo-full.svg and mobile logo-full.svg are rendered
    const logo = page.locator('img[alt="Lanyard Health"]').first();
    await expect(logo).toBeVisible();

    // Heading — exact match to avoid colliding with the dev-bypass "Welcome back" toast title
    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
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

    await expect(page.getByText('Lanyard Health', { exact: true }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: 'Dashboard', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Providers', exact: true })).toBeVisible();
  });

  test('sign out redirects to login', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('button', { name: 'Login as Dev Admin' }).click();
    await page.waitForURL('/', { timeout: 15000 });

    // Open user dropdown menu, then click Sign out
    await page.getByRole('button', { name: 'Open user menu' }).click();
    await page.getByText('Sign out').click();

    await page.waitForURL('/login', { timeout: 10000 });
    await expect(page.getByText('Welcome back')).toBeVisible();
  });
});
