import { test, expect } from '@playwright/test';

test.describe('Authentication', () => {
  test('should display login page', async ({ page }) => {
    await page.goto('/login');

    // Check for ZapDesk branding
    await expect(page.locator('text=ZapDesk')).toBeVisible();

    // Check for Microsoft sign-in button
    await expect(page.locator('text=Sign in with Microsoft')).toBeVisible();

    // Check for welcome message
    await expect(page.locator('text=Welcome back')).toBeVisible();
  });

  test('should redirect unauthenticated users to login', async ({ page }) => {
    await page.goto('/');

    // Should redirect to login page
    await expect(page).toHaveURL(/\/login/);
  });

  test('should redirect unauthenticated users from tickets page', async ({ page }) => {
    await page.goto('/tickets');

    // Should redirect to login page
    await expect(page).toHaveURL(/\/login/);
  });

  test('login page should have contact support link', async ({ page }) => {
    await page.goto('/login');

    // Check for support link
    await expect(page.locator('text=Contact support')).toBeVisible();
  });
});
