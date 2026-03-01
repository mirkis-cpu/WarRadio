/**
 * Quick diagnostic script — opens Suno /create, logs all iframes + captcha selectors,
 * takes a screenshot so we can see what captcha type Suno is using now.
 */
import 'dotenv/config';
import { chromium } from 'playwright';
import { promises as fs } from 'fs';
import path from 'path';

const SESSION_PATH = process.env.SESSION_PATH || './data/sessions/storageState.json';
const SCREENSHOT_DIR = './media/debug';

async function main() {
  // Load session state
  let storageState: object | undefined;
  try {
    const raw = await fs.readFile(SESSION_PATH, 'utf-8');
    storageState = JSON.parse(raw);
    console.log('✓ Session state loaded from', SESSION_PATH);
  } catch {
    console.log('⚠ No session state found — starting fresh');
  }

  const browser = await chromium.launch({
    headless: false,
    slowMo: 100,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-infobars',
      '--window-size=1280,800',
    ],
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    storageState: storageState as any,
    viewport: { width: 1280, height: 800 },
    locale: 'en-US',
    timezoneId: 'America/New_York',
  });

  // Anti-detection
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    (globalThis as any).chrome = { runtime: {} };
  });

  const page = await context.newPage();

  console.log('\n→ Navigating to https://suno.com/create ...');
  await page.goto('https://suno.com/create', { waitUntil: 'domcontentloaded', timeout: 30_000 });

  // Wait for page to render
  console.log('→ Waiting 8s for page to render...');
  await new Promise(r => setTimeout(r, 8000));

  // ── Dump all iframes ──────────────────────────────────────────────────────
  console.log('\n══════════════════════════════════════════');
  console.log('ALL IFRAMES ON PAGE:');
  console.log('══════════════════════════════════════════');
  const iframes = await page.locator('iframe').all();
  if (iframes.length === 0) {
    console.log('  (none)');
  }
  for (let i = 0; i < iframes.length; i++) {
    const src = await iframes[i].getAttribute('src').catch(() => '(error)');
    const visible = await iframes[i].isVisible().catch(() => false);
    const box = await iframes[i].boundingBox().catch(() => null);
    console.log(`  [${i}] src: ${src}`);
    console.log(`       visible: ${visible}, box: ${JSON.stringify(box)}`);
  }

  // ── Test all captcha selectors ────────────────────────────────────────────
  console.log('\n══════════════════════════════════════════');
  console.log('CAPTCHA SELECTOR TESTS:');
  console.log('══════════════════════════════════════════');

  const selectors = [
    // hCaptcha
    'iframe[src*="hcaptcha.com"]',
    // Cloudflare Turnstile
    'iframe[src*="challenges.cloudflare.com"]',
    'iframe[src*="turnstile"]',
    'div.cf-turnstile',
    '[data-sitekey]',
    // Arkose / FunCaptcha
    'iframe[src*="arkoselabs"]',
    'iframe[src*="funcaptcha"]',
    // Generic captcha
    'iframe[src*="captcha"]',
    '[class*="captcha"]',
    '[id*="captcha"]',
    '[data-callback*="captcha"]',
    // reCAPTCHA
    'iframe[src*="recaptcha"]',
    'iframe[src*="google.com/recaptcha"]',
    '.g-recaptcha',
    // Text indicators
    'text=/Verify you are human/i',
    'text=/Select all/i',
    'text=/I am human/i',
    'text=/confirm you are not a robot/i',
    // Cloudflare challenge page
    '#challenge-running',
    '#challenge-form',
    '#challenge-stage',
  ];

  for (const sel of selectors) {
    try {
      const count = await page.locator(sel).count();
      if (count > 0) {
        const el = page.locator(sel).first();
        const visible = await el.isVisible({ timeout: 1000 }).catch(() => false);
        console.log(`  ✓ MATCH: ${sel}  (count=${count}, visible=${visible})`);
      }
    } catch {
      // selector didn't match
    }
  }

  // ── Screenshot ────────────────────────────────────────────────────────────
  await fs.mkdir(SCREENSHOT_DIR, { recursive: true });
  const screenshotPath = path.join(SCREENSHOT_DIR, 'captcha-diagnostic.png');
  await page.screenshot({ path: screenshotPath, fullPage: true });
  console.log(`\n→ Screenshot saved: ${screenshotPath}`);

  // ── Page URL + title ──────────────────────────────────────────────────────
  console.log(`\n→ Current URL: ${page.url()}`);
  console.log(`→ Page title: ${await page.title()}`);

  // ── Keep browser open for manual inspection ───────────────────────────────
  console.log('\n→ Browser stays open for inspection. Press Ctrl+C to close.');

  // Wait indefinitely
  await new Promise(() => {});
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
