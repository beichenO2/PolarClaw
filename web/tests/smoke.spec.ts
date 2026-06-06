import { test, expect } from '@playwright/test';

/**
 * PolarClaw Web Smoke Tests
 * Core user flow: App loads → Main features accessible → Key interactions work
 */

test.describe('PolarClaw Web Smoke Tests', () => {
  
  test('01 - App loads successfully', async ({ page }) => {
    await page.goto('/');
    
    // Check page title or main heading exists
    const body = page.locator('body');
    await expect(body).toBeVisible();
    
    // Check no critical console errors
    const errors: string[] = [];
    page.on('console', msg => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    
    // Wait for initial render
    await page.waitForTimeout(1000);
    
    // Should have no critical errors
    expect(errors.filter(e => !e.includes('favicon'))).toHaveLength(0);
  });

  test('02 - Navigation structure accessible', async ({ page }) => {
    await page.goto('/');
    
    // Check for navigation or menu elements
    const nav = page.locator('nav, header, [role="navigation"], .sidebar, aside');
    
    // At least one navigation structure should exist
    const navExists = await nav.count() > 0;
    expect(navExists).toBeTruthy();
  });

  test('03 - Main content area renders', async ({ page }) => {
    await page.goto('/');
    
    // Check for main content area
    const main = page.locator('main, [role="main"], #root, .app, .container');
    await expect(main.first()).toBeVisible({ timeout: 5000 });
  });

  test('04 - Interactive elements respond', async ({ page }) => {
    await page.goto('/');
    
    // Find clickable elements
    const clickables = page.locator('button, a, [role="button"], input, select, textarea');
    const count = await clickables.count();
    
    // App should have at least some interactive elements
    expect(count).toBeGreaterThan(0);
    
    // Try clicking first button if exists
    const firstButton = page.locator('button').first();
    if (await firstButton.count() > 0) {
      await firstButton.click();
      // Should not crash
      await page.waitForTimeout(500);
    }
  });

  test('05 - Route navigation works', async ({ page, baseURL }) => {
    // Check if React Router routes exist by testing navigation
    await page.goto(baseURL!);
    
    // Get all anchor links
    const links = page.locator('a[href^="/"]');
    const linkCount = await links.count();
    
    if (linkCount > 0) {
      // Click first internal link
      const firstLink = links.first();
      const href = await firstLink.getAttribute('href');
      
      await firstLink.click();
      await page.waitForURL(`**${href}`);
      
      // Page should still be functional
      await expect(page.locator('body')).toBeVisible();
    }
  });

  test('06 - Forms can be interacted with', async ({ page }) => {
    await page.goto('/');
    
    // Find form inputs
    const inputs = page.locator('input:not([type="hidden"]), textarea');
    const inputCount = await inputs.count();
    
    if (inputCount > 0) {
      // Type in first input
      const firstInput = inputs.first();
      await firstInput.fill('test input');
      
      // Value should be set
      await expect(firstInput).toHaveValue('test input');
    }
  });

  test('07 - Responsive layout basic check', async ({ page }) => {
    // Test desktop viewport
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/');
    await expect(page.locator('body')).toBeVisible();
    
    // Test tablet viewport
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto('/');
    await expect(page.locator('body')).toBeVisible();
    
    // Test mobile viewport  
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/');
    await expect(page.locator('body')).toBeVisible();
  });

  test('08 - Page performance - basic load time', async ({ page, baseURL }) => {
    const startTime = Date.now();
    
    await page.goto(baseURL!);
    await page.waitForLoadState('domcontentloaded');
    
    const loadTime = Date.now() - startTime;
    
    // Should load within 5 seconds
    expect(loadTime).toBeLessThan(5000);
  });
});
