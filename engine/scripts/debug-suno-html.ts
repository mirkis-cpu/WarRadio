#!/usr/bin/env npx tsx
/**
 * Debug: dump HTML of Suno /create page in Custom mode
 */
import 'dotenv/config';
import { writeFileSync, mkdirSync } from 'fs';
import { SunoSession } from '../src/suno/session.js';
import { sleep } from '../src/utils/sleep.js';

async function main() {
  console.log('Loading Suno session...');
  const session = new SunoSession();
  await session.initialize(false, 0); // visible, no slowMo

  const page = await session.newPage();
  await page.goto('https://suno.com/create', { waitUntil: 'domcontentloaded', timeout: 30000 });

  // Wait for form to render
  console.log('Waiting for page to render...');
  await page.waitForSelector('button:has-text("Custom"), button:has-text("Simple")', { timeout: 15000 });

  // Screenshot before Custom
  mkdirSync('./media/debug', { recursive: true });
  await page.screenshot({ path: './media/debug/01-before-custom.png' });
  console.log('Screenshot: 01-before-custom.png');

  // Click Custom
  console.log('Clicking Custom...');
  const customBtn = page.locator('button:has-text("Custom")').first();
  await customBtn.click();
  await sleep(2000);

  // Screenshot after Custom
  await page.screenshot({ path: './media/debug/02-after-custom.png' });
  console.log('Screenshot: 02-after-custom.png');

  // Dump all textareas
  console.log('\n=== Visible textareas ===');
  const textareas = await page.locator('textarea').all();
  for (const ta of textareas) {
    const ph = await ta.getAttribute('placeholder').catch(() => '');
    const vis = await ta.isVisible().catch(() => false);
    console.log(`  visible=${vis} placeholder="${ph}"`);
  }

  // Dump all buttons
  console.log('\n=== Visible buttons ===');
  const buttons = await page.locator('button').all();
  for (const btn of buttons.slice(0, 20)) {
    const text = await btn.innerText().catch(() => '');
    const vis = await btn.isVisible().catch(() => false);
    if (vis && text.trim()) console.log(`  [button] "${text.trim().slice(0, 80)}"`);
  }

  // Dump all inputs
  console.log('\n=== Visible inputs ===');
  const inputs = await page.locator('input').all();
  for (const inp of inputs) {
    const ph = await inp.getAttribute('placeholder').catch(() => '');
    const type = await inp.getAttribute('type').catch(() => '');
    const vis = await inp.isVisible().catch(() => false);
    if (vis) console.log(`  [input] type="${type}" placeholder="${ph}"`);
  }

  // Get the create form HTML
  console.log('\n=== Create form inner HTML (first 3000 chars) ===');
  const formHtml = await page.evaluate(() => {
    // Find the main form area
    const doc = (globalThis as any).document;
    const forms = doc.querySelectorAll('form');
    if (forms.length > 0) return forms[0].innerHTML.slice(0, 3000);
    // Fallback: get the left panel area
    const main = doc.querySelector('main') || doc.querySelector('[role="main"]');
    if (main) return main.innerHTML.slice(0, 3000);
    return doc.body.innerHTML.slice(0, 3000);
  });
  console.log(formHtml);

  await page.close();
  await session.destroy();
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
