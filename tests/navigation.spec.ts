import { test, expect } from '@playwright/test';

test.describe('Navigation (unauthenticated)', () => {
  test('login page loads correctly', async ({ page }) => {
    await page.goto('/login');

    // Page should load without errors
    await expect(page.locator('body')).toBeVisible();

    // Should have the DevDesk logo/branding
    await expect(page.locator('text=DevDesk')).toBeVisible();
  });

  test('should display sign in with Microsoft button', async ({ page }) => {
    await page.goto('/login');

    const signInButton = page.locator('button:has-text("Sign in with Microsoft")');
    await expect(signInButton).toBeVisible();
    await expect(signInButton).toBeEnabled();
  });

  test('login page has proper metadata', async ({ page }) => {
    await page.goto('/login');

    // Check page title
    await expect(page).toHaveTitle(/DevDesk/);
  });
});

test.describe('Protected routes redirect', () => {
  test('tickets page redirects to login', async ({ page }) => {
    await page.goto('/tickets');
    await expect(page).toHaveURL(/\/login/);
  });

  test('customers page redirects to login', async ({ page }) => {
    await page.goto('/customers');
    await expect(page).toHaveURL(/\/login/);
  });

  test('organizations page redirects to login', async ({ page }) => {
    await page.goto('/organizations');
    await expect(page).toHaveURL(/\/login/);
  });
});
