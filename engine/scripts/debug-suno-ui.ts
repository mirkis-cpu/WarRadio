#!/usr/bin/env npx tsx
/**
 * Debug Suno UI — opens browser, navigates to /create, takes screenshots.
 * Helps identify correct selectors for form fields.
 *
 * Usage: npx tsx scripts/debug-suno-ui.ts
 */
import 'dotenv/config';
import { chromium } from 'playwright';
import { mkdirSync, existsSync, readFileSync } from 'fs';
import path from 'path';

const SESSION_PATH = './data/sessions/storageState.json';
const SCREENSHOTS_DIR = './media/debug';

async function main() {
  console.log('=== Suno UI Debug ===\n');
  mkdirSync(SCREENSHOTS_DIR, { recursive: true });

  // Load session if exists
  let storageState: object | undefined;
  if (existsSync(SESSION_PATH)) {
    storageState = JSON.parse(readFileSync(SESSION_PATH, 'utf-8'));
    console.log('Loaded existing session state');
  }

  const browser = await chromium.launch({
    headless: false,
    slowMo: 100,
    args: ['--disable-blink-features=AutomationControlled', '--no-sandbox'],
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    storageState: storageState as any,
    viewport: { width: 1280, height: 900 },
  });

  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  const page = await context.newPage();

  // 1. Homepage
  console.log('\n1. Loading suno.com...');
  await page.goto('https://suno.com', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '01-homepage.png'), fullPage: false });
  console.log(`   URL: ${page.url()}`);
  console.log('   Screenshot: 01-homepage.png');

  // Check auth state
  const bodyText = await page.locator('body').innerText().catch(() => '');
  const hasSignIn = bodyText.toLowerCase().includes('sign in') || bodyText.toLowerCase().includes('log in');
  const hasCreate = bodyText.toLowerCase().includes('create');
  console.log(`   Has "Sign In": ${hasSignIn}`);
  console.log(`   Has "Create": ${hasCreate}`);

  // 2. Create page
  console.log('\n2. Loading /create...');
  await page.goto('https://suno.com/create', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '02-create-page.png'), fullPage: false });
  console.log(`   URL: ${page.url()}`);
  console.log('   Screenshot: 02-create-page.png');

  // 3. Dump all visible buttons
  console.log('\n3. Visible buttons:');
  const buttons = await page.locator('button').all();
  for (const btn of buttons.slice(0, 20)) {
    const text = await btn.innerText().catch(() => '(empty)');
    const testId = await btn.getAttribute('data-testid').catch(() => null);
    if (text.trim()) {
      console.log(`   [button] "${text.trim().slice(0, 60)}" ${testId ? `data-testid="${testId}"` : ''}`);
    }
  }

  // 4. Dump all textareas and inputs
  console.log('\n4. Visible textareas:');
  const textareas = await page.locator('textarea').all();
  for (const ta of textareas) {
    const ph = await ta.getAttribute('placeholder').catch(() => null);
    const name = await ta.getAttribute('name').catch(() => null);
    const label = await ta.getAttribute('aria-label').catch(() => null);
    console.log(`   [textarea] placeholder="${ph}" name="${name}" aria-label="${label}"`);
  }

  console.log('\n5. Visible inputs:');
  const inputs = await page.locator('input').all();
  for (const inp of inputs) {
    const type = await inp.getAttribute('type').catch(() => null);
    const ph = await inp.getAttribute('placeholder').catch(() => null);
    const name = await inp.getAttribute('name').catch(() => null);
    console.log(`   [input] type="${type}" placeholder="${ph}" name="${name}"`);
  }

  // 6. Look for Custom mode
  console.log('\n6. Looking for "Custom" text...');
  const customElements = await page.locator(':text("Custom")').all();
  for (const el of customElements.slice(0, 5)) {
    const tag = await el.evaluate((e: Element) => e.tagName).catch(() => '?');
    const cls = await el.getAttribute('class').catch(() => '');
    console.log(`   [${tag}] class="${cls?.slice(0, 80)}"`);
  }

  console.log('\n\nBrowser is open — inspect the page manually.');
  console.log('Press Ctrl+C when done.');
  await new Promise(() => {}); // keep alive
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
