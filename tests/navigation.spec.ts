import { test, expect } from '@playwright/test';

test.describe('Navigation (unauthenticated)', () => {
  test('login page loads correctly', async ({ page }) => {
    await page.goto('/login');

    // Page should load without errors
    await expect(page.locator('body')).toBeVisible();

    // Should have the ZapDesk logo/branding
    await expect(page.getByRole('heading', { name: 'ZapDesk' })).toBeVisible();
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
    await expect(page).toHaveTitle(/ZapDesk/);
  });
});

test.describe('Protected routes redirect', () => {
  test('tickets page redirects to login', async ({ page }) => {
    await page.goto('/tickets');
    await expect(page).toHaveURL(/\/login/);
  });

  test('projects page redirects to login', async ({ page }) => {
    await page.goto('/projects');
    await expect(page).toHaveURL(/\/login/);
  });
});
