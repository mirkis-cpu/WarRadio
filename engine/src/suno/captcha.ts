import type { Page, Frame } from 'playwright';
import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { logger } from '../utils/logger.js';
import { sleep } from '../utils/sleep.js';
import { getConfig } from '../config.js';

const execFileAsync = promisify(execFile);

const HCAPTCHA_IFRAME_SELECTOR = 'iframe[src*="hcaptcha.com"]';
const MANUAL_WAIT_MS = 120_000; // 2 minutes
const POLL_INTERVAL_MS = 2_000;
const TWO_CAPTCHA_BASE_URL = 'https://2captcha.com/in.php';
const TWO_CAPTCHA_RESULT_URL = 'https://2captcha.com/res.php';
const TWO_CAPTCHA_POLL_INTERVAL_MS = 5_000;
const TWO_CAPTCHA_MAX_POLLS = 60; // 5 minutes max

export class CaptchaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CaptchaError';
  }
}

/** Detect if an hCaptcha iframe is visible on the page. */
export async function detectHCaptcha(page: Page): Promise<boolean> {
  try {
    const iframe = page.locator(HCAPTCHA_IFRAME_SELECTOR).first();
    return await iframe.isVisible({ timeout: 3_000 });
  } catch {
    return false;
  }
}

/**
 * Handle hCaptcha according to the configured SUNO_CAPTCHA_MODE:
 *
 * - 'manual': Wait up to 120 seconds for the user to solve it manually.
 * - '2captcha': Submit to 2Captcha API and apply the token programmatically.
 * - 'skip': Throw a CaptchaError immediately.
 */
export async function handleCaptcha(page: Page): Promise<void> {
  const isCaptchaPresent = await detectHCaptcha(page);
  if (!isCaptchaPresent) return;

  const { SUNO_CAPTCHA_MODE } = getConfig();
  logger.warn({ mode: SUNO_CAPTCHA_MODE }, 'hCaptcha detected');

  switch (SUNO_CAPTCHA_MODE) {
    case 'manual':
      await handleManualCaptcha(page);
      break;
    case '2captcha':
      await handleTwoCaptcha(page);
      break;
    case 'skip':
      throw new CaptchaError('hCaptcha detected and SUNO_CAPTCHA_MODE=skip — aborting generation');
    default:
      throw new CaptchaError(`Unknown captcha mode: ${SUNO_CAPTCHA_MODE}`);
  }
}

async function handleManualCaptcha(page: Page): Promise<void> {
  logger.info(`hCaptcha requires manual solving. Waiting up to ${MANUAL_WAIT_MS / 1000}s...`);

  const deadline = Date.now() + MANUAL_WAIT_MS;
  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);
    const stillPresent = await detectHCaptcha(page);
    if (!stillPresent) {
      logger.info('hCaptcha resolved (manual)');
      return;
    }
    const remaining = Math.round((deadline - Date.now()) / 1000);
    logger.info({ remainingSeconds: remaining }, 'Waiting for manual captcha solve...');
  }

  throw new CaptchaError(`hCaptcha not solved within ${MANUAL_WAIT_MS / 1000} seconds`);
}

async function handleTwoCaptcha(page: Page): Promise<void> {
  const { CAPTCHA_2_API_KEY } = getConfig();
  if (!CAPTCHA_2_API_KEY) {
    throw new CaptchaError('SUNO_CAPTCHA_MODE=2captcha but CAPTCHA_2_API_KEY is not configured');
  }

  const siteKey = await extractSiteKey(page);
  if (!siteKey) {
    throw new CaptchaError('Could not extract hCaptcha site key from page');
  }

  const pageUrl = page.url();
  logger.info({ siteKey, pageUrl }, 'Submitting hCaptcha to 2Captcha');

  // Submit captcha task
  const taskId = await submitTo2Captcha(CAPTCHA_2_API_KEY, siteKey, pageUrl);
  logger.info({ taskId }, '2Captcha task submitted, polling for result');

  // Poll for result
  const token = await pollFor2CaptchaResult(CAPTCHA_2_API_KEY, taskId);
  logger.info({ taskId }, '2Captcha token received');

  // Inject token into hCaptcha response field and submit
  await injectCaptchaToken(page, token);
  logger.info('hCaptcha token injected');
}

async function extractSiteKey(page: Page): Promise<string | null> {
  try {
    const iframe = page.locator(HCAPTCHA_IFRAME_SELECTOR).first();
    const src = await iframe.getAttribute('src');
    if (!src) return null;
    const match = src.match(/[?&]sitekey=([^&]+)/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

async function submitTo2Captcha(apiKey: string, siteKey: string, pageUrl: string): Promise<string> {
  const params = new URLSearchParams({
    key: apiKey,
    method: 'hcaptcha',
    sitekey: siteKey,
    pageurl: pageUrl,
    json: '1',
  });

  const response = await fetch(`${TWO_CAPTCHA_BASE_URL}?${params}`);
  if (!response.ok) {
    throw new CaptchaError(`2Captcha submit HTTP error: ${response.status}`);
  }

  const data = await response.json() as { status: number; request: string };
  if (data.status !== 1) {
    throw new CaptchaError(`2Captcha submit failed: ${data.request}`);
  }

  return data.request;
}

async function pollFor2CaptchaResult(apiKey: string, taskId: string): Promise<string> {
  for (let i = 0; i < TWO_CAPTCHA_MAX_POLLS; i++) {
    await sleep(TWO_CAPTCHA_POLL_INTERVAL_MS);

    const params = new URLSearchParams({
      key: apiKey,
      action: 'get',
      id: taskId,
      json: '1',
    });

    const response = await fetch(`${TWO_CAPTCHA_RESULT_URL}?${params}`);
    if (!response.ok) continue;

    const data = await response.json() as { status: number; request: string };

    if (data.status === 1) {
      return data.request;
    }

    if (data.request !== 'CAPCHA_NOT_READY') {
      throw new CaptchaError(`2Captcha error: ${data.request}`);
    }

    logger.debug({ poll: i + 1, taskId }, '2Captcha not ready yet');
  }

  throw new CaptchaError(`2Captcha token not received after ${TWO_CAPTCHA_MAX_POLLS} polls`);
}

async function injectCaptchaToken(page: Page, token: string): Promise<void> {
  // Fill the hcaptcha response textarea directly via Playwright
  const textarea = page.locator('textarea[name="h-captcha-response"]').first();
  const isVisible = await textarea.isVisible({ timeout: 2_000 }).catch(() => false);
  if (isVisible) {
    await textarea.fill(token);
  }

  // Also evaluate in page context to dispatch change event
  await page.evaluate((t) => {
    const el = (globalThis as any).document?.querySelector?.('textarea[name="h-captcha-response"]');
    if (el) {
      el.value = t;
      el.dispatchEvent(new (globalThis as any).Event('change', { bubbles: true }));
    }
  }, token);

  // Give the page time to process the token
  await sleep(1_000);
}

// ─── AI Visual Captcha Solver (Claude CLI) ───────────────────────────

const CAPTCHA_SELECTORS = [
  'iframe[src*="arkoselabs"]',
  'iframe[src*="funcaptcha"]',
  'iframe[src*="captcha"]',
  'iframe[src*="challenges.cloudflare.com"]',
  'iframe[src*="turnstile"]',
  'div.cf-turnstile',
  '[class*="captcha"]',
  '[id*="captcha"]',
  '[data-callback*="captcha"]',
  'text=/Select all/i',
  'text=/Verify you are human/i',
  'text=/I am human/i',
];

const AI_SOLVE_MAX_ATTEMPTS = 3;

/** Detect visual captcha overlay (Arkose FunCaptcha, image grid, etc.) */
export async function detectVisualCaptcha(page: Page): Promise<boolean> {
  // Log all iframes on the page for debugging
  const iframes = await page.locator('iframe').all();
  for (const iframe of iframes) {
    const src = await iframe.getAttribute('src').catch(() => '');
    if (src) logger.debug({ src: src.slice(0, 120) }, 'iframe found on page');
  }

  // Check selectors on main page
  for (const selector of CAPTCHA_SELECTORS) {
    const el = page.locator(selector).first();
    const count = await page.locator(selector).count();
    if (count > 0) {
      const visible = await el.isVisible({ timeout: 2_000 }).catch(() => false);
      logger.info({ selector, count, visible }, 'Captcha selector match');
      if (visible) return true;
    }
  }

  // Also check nested frames for captcha content (Arkose uses nested iframes)
  for (const frame of page.frames()) {
    if (frame === page.mainFrame()) continue;
    const url = frame.url();
    if (url.includes('arkoselabs') || url.includes('funcaptcha') || url.includes('captcha')) {
      logger.info({ url: url.slice(0, 120) }, 'Captcha iframe detected via frame URL');
      return true;
    }
  }

  logger.info('No visual captcha detected');
  return false;
}

/**
 * Solve visual captcha using Claude CLI as image analyzer.
 * Takes screenshot → sends to Claude → parses grid cell clicks → clicks them.
 * Retries up to AI_SOLVE_MAX_ATTEMPTS times.
 */
export async function solveVisualCaptchaWithAI(page: Page): Promise<boolean> {
  for (let attempt = 1; attempt <= AI_SOLVE_MAX_ATTEMPTS; attempt++) {
    logger.info({ attempt }, 'Attempting AI captcha solve...');

    // Take screenshot of current page
    const screenshotPath = path.resolve('./media/debug/captcha-solve.png');
    await page.screenshot({ path: screenshotPath });

    // Ask Claude to analyze the captcha
    const clicks = await askClaudeForCaptchaSolution(screenshotPath);
    if (!clicks || clicks.length === 0) {
      logger.warn({ attempt }, 'Claude returned no clicks — retrying');
      continue;
    }

    logger.info({ attempt, clicks }, 'Claude identified cells to click');

    // Click the identified grid cells
    await clickCaptchaGridCells(page, clicks);

    // Wait for captcha to process
    await sleep(3000);

    // Check if captcha is gone
    const stillPresent = await detectVisualCaptcha(page);
    if (!stillPresent) {
      logger.info({ attempt }, 'AI captcha solve successful!');
      return true;
    }

    logger.warn({ attempt }, 'Captcha still present after clicking — may need another round');
    await sleep(2000);
  }

  logger.error('AI captcha solve failed after all attempts');
  return false;
}

/**
 * Call Claude CLI to analyze a captcha screenshot.
 * Returns array of 1-based cell numbers to click.
 */
async function askClaudeForCaptchaSolution(screenshotPath: string): Promise<number[]> {
  const prompt = `Look at the image at this path and analyze the captcha: ${screenshotPath}

There is a visual captcha overlay with a grid of images and an instruction text (like "Select all objects that..." or similar).

1. Read the instruction text from the captcha
2. Look at each image in the grid
3. Determine which images match the instruction

Number the grid cells 1, 2, 3... left-to-right, top-to-bottom.
Return ONLY a JSON object, nothing else: {"clicks": [cell_numbers_to_click]}`;

  try {
    const { stdout } = await execFileAsync('claude', [
      '-p', prompt,
      '--allowedTools', 'Read',
      '--output-format', 'json',
      '--model', 'sonnet',
    ], {
      timeout: 30_000,
      env: { ...process.env, CLAUDECODE: '' }, // Allow nested CLI
    });

    // Parse Claude's JSON output
    const response = JSON.parse(stdout) as { result?: string; is_error?: boolean };
    if (response.is_error || !response.result) {
      logger.warn({ response: stdout.slice(0, 200) }, 'Claude CLI returned error');
      return [];
    }

    // Extract clicks array from the response text
    const match = response.result.match(/\{"clicks"\s*:\s*\[[\d,\s]+\]\}/);
    if (match) {
      const parsed = JSON.parse(match[0]) as { clicks: number[] };
      return parsed.clicks;
    }

    // Try to find any array of numbers
    const arrayMatch = response.result.match(/\[[\d,\s]+\]/);
    if (arrayMatch) {
      return JSON.parse(arrayMatch[0]) as number[];
    }

    logger.warn({ result: response.result.slice(0, 300) }, 'Could not parse clicks from Claude response');
    return [];
  } catch (err) {
    logger.error({ error: String(err) }, 'Claude CLI captcha analysis failed');
    return [];
  }
}

/**
 * Click specific cells in a captcha image grid.
 * Locates the grid area and calculates click positions.
 */
/**
 * Find the captcha iframe (Arkose FunCaptcha is always inside nested iframes).
 * Returns the innermost frame containing the challenge grid, or null.
 */
async function findCaptchaFrame(page: Page): Promise<Frame | null> {
  // Arkose uses nested iframes: outer enforcement → inner game_core/challenge
  const iframeSrcPatterns = ['arkoselabs', 'funcaptcha', 'captcha', 'challenge'];

  for (const frame of page.frames()) {
    const url = frame.url();
    if (iframeSrcPatterns.some(p => url.includes(p))) {
      // Check if this frame has the image grid
      const imgCount = await frame.locator('img').count().catch(() => 0);
      if (imgCount >= 4) {
        logger.info({ url: url.slice(0, 100), imgCount }, 'Found captcha frame with images');
        return frame;
      }
    }
  }

  // Fallback: search all frames for one containing multiple images (typical grid)
  for (const frame of page.frames()) {
    if (frame === page.mainFrame()) continue;
    const imgCount = await frame.locator('img').count().catch(() => 0);
    if (imgCount >= 4) {
      logger.info({ url: frame.url().slice(0, 100), imgCount }, 'Found likely captcha frame (fallback)');
      return frame;
    }
  }

  return null;
}

async function clickCaptchaGridCells(page: Page, cellNumbers: number[]): Promise<void> {
  // Try to find captcha iframe first (FunCaptcha images are inside iframes)
  const captchaFrame = await findCaptchaFrame(page);
  const target: Page | Frame = captchaFrame ?? page;

  if (captchaFrame) {
    logger.info('Using captcha iframe for clicking');
  } else {
    logger.info('No captcha iframe found, using main page');
  }

  // Find the image grid inside the target (frame or page)
  const gridSelectors = [
    'img[class*="challenge"]',
    '.challenge img',
    '[class*="captcha"] img',
    '[role="dialog"] img',
    'img',
  ];

  let images: any[] = [];
  for (const selector of gridSelectors) {
    images = await target.locator(selector).all();
    if (images.length >= 4) {
      logger.info({ selector, count: images.length }, 'Found grid images');
      break;
    }
  }

  if (images.length >= 4) {
    for (const cellNum of cellNumbers) {
      const idx = cellNum - 1;
      if (idx >= 0 && idx < images.length) {
        await images[idx].click({ force: true });
        await sleep(500);
        logger.info({ cell: cellNum }, 'Clicked captcha grid cell (by image)');
      }
    }

    // Look for submit/verify button
    const submitBtn = target.locator('button:has-text("Submit"), button:has-text("Verify"), button:has-text("Done"), button:has-text("Next")').first();
    const submitVisible = await submitBtn.isVisible({ timeout: 2000 }).catch(() => false);
    if (submitVisible) {
      await submitBtn.click();
      logger.info('Clicked captcha submit button');
    }
    return;
  }

  // Fallback: click by position using bounding box of the captcha overlay on main page
  // (captcha iframe has a bounding box on the main page even if contents are in iframe)
  const iframeSelectors = [
    'iframe[src*="arkoselabs"]',
    'iframe[src*="funcaptcha"]',
    'iframe[src*="captcha"]',
    '[class*="captcha"]',
    '[role="dialog"]',
  ];

  for (const selector of iframeSelectors) {
    const el = page.locator(selector).first();
    const visible = await el.isVisible({ timeout: 2000 }).catch(() => false);
    if (!visible) continue;

    const box = await el.boundingBox();
    if (!box || box.width < 100 || box.height < 100) continue;

    logger.info({ selector, box: { x: box.x, y: box.y, w: box.width, h: box.height } }, 'Using bounding box for grid clicks');

    const cols = 3;
    const rows = Math.ceil(Math.max(...cellNumbers) / cols);
    const cellW = box.width / cols;
    const cellH = box.height / rows;

    for (const cellNum of cellNumbers) {
      const idx = cellNum - 1;
      const col = idx % cols;
      const row = Math.floor(idx / cols);
      const x = box.x + col * cellW + cellW / 2;
      const y = box.y + row * cellH + cellH / 2;

      await page.mouse.click(x, y);
      await sleep(500);
      logger.info({ cell: cellNum, x: Math.round(x), y: Math.round(y) }, 'Clicked captcha grid cell (by position)');
    }
    return;
  }

  logger.warn('Could not find captcha grid to click');
}
