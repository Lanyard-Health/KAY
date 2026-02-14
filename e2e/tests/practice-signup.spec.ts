import { test, expect } from '@playwright/test';

test.describe('Practice Signup Page', () => {
  test.use({ storageState: { cookies: [], origins: [] } }); // no saved auth

  test('signup page renders with brand design', async ({ page }) => {
    await page.goto('/practice-signup');

    // Green gradient background
    const body = page.locator('.bg-gradient-to-br');
    await expect(body).toBeVisible();

    // Logo
    const logo = page.locator('img[src="/logo.png"]');
    await expect(logo).toBeVisible();

    // Heading
    await expect(page.getByText('Sign up your practice')).toBeVisible();
    await expect(page.getByText('Start managing your credentialing workflow today')).toBeVisible();
  });

  test('signup form has all required fields', async ({ page }) => {
    await page.goto('/practice-signup');

    await expect(page.getByLabel('Practice Name')).toBeVisible();
    await expect(page.getByLabel('First Name')).toBeVisible();
    await expect(page.getByLabel('Last Name')).toBeVisible();
    await expect(page.getByLabel('Email')).toBeVisible();
    await expect(page.getByLabel('Phone')).toBeVisible();
    await expect(page.getByLabel('Password', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Confirm Password')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create Account' })).toBeVisible();
  });

  test('password strength indicator shows requirements', async ({ page }) => {
    await page.goto('/practice-signup');

    const passwordInput = page.getByLabel('Password', { exact: true });
    await passwordInput.fill('abc');

    // Strength indicator should appear with checks
    await expect(page.getByText('12+ characters')).toBeVisible();
    await expect(page.getByText('Uppercase letter')).toBeVisible();
    await expect(page.getByText('Lowercase letter')).toBeVisible();
    await expect(page.getByText('Number')).toBeVisible();
    await expect(page.getByText('Special character')).toBeVisible();
  });

  test('shows validation error for mismatched passwords', async ({ page }) => {
    await page.goto('/practice-signup');

    await page.getByLabel('Practice Name').fill('Test Practice');
    await page.getByLabel('First Name').fill('John');
    await page.getByLabel('Last Name').fill('Doe');
    await page.getByLabel('Email').fill('john@unique-e2e-test.com');
    await page.getByLabel('Phone').fill('555-123-4567');
    await page.getByLabel('Password', { exact: true }).fill('SecurePass123@');
    await page.getByLabel('Confirm Password').fill('DifferentPass123@');

    await page.getByRole('button', { name: 'Create Account' }).click();

    // Toast error for mismatch
    await expect(page.getByText('Passwords do not match')).toBeVisible({ timeout: 5000 });
  });

  test('has link back to login page', async ({ page }) => {
    await page.goto('/practice-signup');

    const loginLink = page.getByRole('link', { name: 'Sign in' });
    await expect(loginLink).toBeVisible();
    await loginLink.click();
    await expect(page).toHaveURL('/login');
  });

  test('login page has link to practice signup', async ({ page }) => {
    await page.goto('/login');

    const signupLink = page.getByRole('link', { name: 'Sign up your practice' });
    await expect(signupLink).toBeVisible();
    await signupLink.click();
    await expect(page).toHaveURL('/practice-signup');
  });

  test('login page shows dev practice admin button', async ({ page }) => {
    await page.goto('/login');

    await expect(page.getByRole('button', { name: 'Login as Dev Practice Admin' })).toBeVisible();
  });

  test('successful signup redirects to dashboard', async ({ page }) => {
    await page.goto('/practice-signup');

    const unique = Date.now();
    await page.getByLabel('Practice Name').fill(`E2E Test Practice ${unique}`);
    await page.getByLabel('First Name').fill('E2E');
    await page.getByLabel('Last Name').fill('Tester');
    await page.getByLabel('Email').fill(`e2e-${unique}@testpractice.com`);
    await page.getByLabel('Phone').fill('555-999-8888');
    await page.getByLabel('Password', { exact: true }).fill('SecurePass123@');
    await page.getByLabel('Confirm Password').fill('SecurePass123@');

    await page.getByRole('button', { name: 'Create Account' }).click();

    // Should show success toast and redirect to dashboard
    await expect(page.getByText('Practice registered successfully')).toBeVisible({ timeout: 10000 });
    await page.waitForURL('/', { timeout: 15000 });
  });

  test('duplicate email shows error', async ({ page }) => {
    await page.goto('/practice-signup');

    // Use the dev admin email which always exists in the database
    await page.getByLabel('Practice Name').fill('Duplicate Test');
    await page.getByLabel('First Name').fill('Dup');
    await page.getByLabel('Last Name').fill('Test');
    await page.getByLabel('Email').fill('admin@dev.local');
    await page.getByLabel('Phone').fill('555-111-2222');
    await page.getByLabel('Password', { exact: true }).fill('SecurePass123@');
    await page.getByLabel('Confirm Password').fill('SecurePass123@');

    await page.getByRole('button', { name: 'Create Account' }).click();

    await expect(page.getByText('already exists')).toBeVisible({ timeout: 10000 });
  });
});
