import type { Page } from 'playwright';
import { logger } from '../utils/logger.js';
import { sleep } from '../utils/sleep.js';
import { getConfig } from '../config.js';

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
