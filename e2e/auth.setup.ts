import { test as setup, expect } from '@playwright/test';

setup('authenticate as admin', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByText('Welcome back')).toBeVisible();

  await page.getByRole('button', { name: 'Login as Dev Admin' }).click();

  // Wait for redirect to dashboard
  await page.waitForURL('/', { timeout: 15000 });
  await expect(page.getByText('Welcome to Lanyard Health')).toBeVisible();

  await page.context().storageState({ path: 'e2e/.auth/admin.json' });
});

setup('authenticate as practice admin', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByText('Welcome back')).toBeVisible();

  await page.getByRole('button', { name: 'Login as Dev Practice Admin' }).click();

  // Wait for redirect to dashboard
  await page.waitForURL('/', { timeout: 15000 });
  await expect(page.getByText('Welcome to Lanyard Health')).toBeVisible();

  await page.context().storageState({ path: 'e2e/.auth/practice-admin.json' });
});

setup('authenticate as provider', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByText('Welcome back')).toBeVisible();

  await page.getByRole('button', { name: 'Login as Dev Provider' }).click();

  // Wait for redirect after login
  await page.waitForURL('/**', { timeout: 15000 });

  await page.context().storageState({ path: 'e2e/.auth/provider.json' });
});
