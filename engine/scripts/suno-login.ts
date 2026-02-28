/**
 * Suno.com Login Script
 *
 * Run this once to authenticate with suno.com:
 *   npm run suno:login
 *
 * Opens a headed browser window. Log in manually via Discord or Facebook
 * (NOT Google - it blocks Playwright). Once logged in, press Enter in
 * the terminal to save the session.
 */
import { chromium } from 'playwright';
import { createInterface } from 'readline';
import { mkdirSync, existsSync } from 'fs';
import { dirname } from 'path';

const SESSION_PATH = './data/sessions/storageState.json';

async function login() {
  // Ensure directory exists
  mkdirSync(dirname(SESSION_PATH), { recursive: true });

  console.log('');
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║           RadioWar - Suno Login                  ║');
  console.log('╠══════════════════════════════════════════════════╣');
  console.log('║                                                  ║');
  console.log('║  A browser window will open. Please:             ║');
  console.log('║                                                  ║');
  console.log('║  1. Click "Sign In" on suno.com                  ║');
  console.log('║  2. Use Discord or Facebook (NOT Google!)        ║');
  console.log('║  3. Complete the login process                   ║');
  console.log('║  4. Wait until you see the dashboard             ║');
  console.log('║  5. Come back here and press ENTER               ║');
  console.log('║                                                  ║');
  console.log('║  ⚠  Google login is blocked by Playwright!      ║');
  console.log('║                                                  ║');
  console.log('╚══════════════════════════════════════════════════╝');
  console.log('');

  const browser = await chromium.launch({
    headless: false,
    slowMo: 100,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
    ],
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 900 },
  });

  const page = await context.newPage();

  // Remove webdriver detection
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  await page.goto('https://suno.com', { waitUntil: 'domcontentloaded' });

  console.log('Browser opened. Please log in...');
  console.log('');

  // Wait for user to press Enter
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  await new Promise<void>(resolve => {
    rl.question('Press ENTER when you are logged in and see the Suno dashboard: ', () => {
      rl.close();
      resolve();
    });
  });

  // Verify we're logged in by checking for common logged-in elements
  try {
    const url = page.url();
    console.log(`Current URL: ${url}`);

    // Save the session state
    await context.storageState({ path: SESSION_PATH });
    console.log('');
    console.log(`Session saved to: ${SESSION_PATH}`);
    console.log('You can now run the RadioWar engine with: npm run dev');
    console.log('');

    if (existsSync(SESSION_PATH)) {
      console.log('Session file verified on disk.');
    }
  } catch (err) {
    console.error('Error saving session:', err);
  }

  await browser.close();
}

login().catch((err) => {
  console.error('Login failed:', err);
  process.exit(1);
});
