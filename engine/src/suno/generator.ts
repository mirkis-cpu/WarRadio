import type { Page, Response } from 'playwright';
import { logger } from '../utils/logger.js';
import { sleep } from '../utils/sleep.js';
import { withRetry } from '../utils/retry.js';
import { handleCaptcha } from './captcha.js';
import type { SunoSession } from './session.js';

const SUNO_CREATE_URL = 'https://suno.com/create';
const GENERATION_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const POLL_INITIAL_DELAY_MS = 60_000; // Wait 60s before first poll (generation takes ~90s)
const POLL_INTERVAL_MS = 10_000;     // Then poll every 10s
const NETWORK_INTERCEPT_TIMEOUT_MS = 30_000;

export interface SunoGenerationInput {
  style: string;   // Maps to sunoStyle from genre definition
  lyrics: string;  // Full lyrics with section markers
  title: string;
}

export interface SunoGenerationResult {
  clipId: string;
  audioUrl: string;
}

export class SunoGenerationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SunoGenerationError';
  }
}

/**
 * Automate Suno.com song generation via Playwright.
 * Navigates to /create, enables Custom Mode, fills in fields, and waits for audio.
 */
export class SunoGenerator {
  private readonly session: SunoSession;

  constructor(session: SunoSession) {
    this.session = session;
  }

  async generate(input: SunoGenerationInput): Promise<SunoGenerationResult> {
    logger.info({ title: input.title }, 'Starting Suno generation');

    const page = await this.session.newPage();

    try {
      const result = await withRetry(
        () => this.doGenerate(page, input),
        { maxAttempts: 2, baseDelay: 5000, label: 'suno-generate' },
      );
      return result;
    } finally {
      await page.close().catch(() => undefined);
    }
  }

  private async doGenerate(page: Page, input: SunoGenerationInput): Promise<SunoGenerationResult> {
    // Set up network interception before navigation
    const clipIdPromise = this.interceptClipId(page);

    // Navigate to create page and wait for React SPA to render
    logger.debug('Navigating to Suno create page...');
    await page.goto(SUNO_CREATE_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    logger.debug({ url: page.url() }, 'Page loaded');

    // Wait for the create form to appear (Custom/Simple buttons)
    try {
      await page.waitForSelector('button:has-text("Custom"), button:has-text("Simple")', { timeout: 15_000 });
      logger.debug('Create form loaded');
    } catch {
      logger.warn('Create form elements not found after 15s — taking screenshot');
      await page.screenshot({ path: './media/debug/create-fail.png' }).catch(() => {});
    }

    // Handle captcha if present
    await handleCaptcha(page);

    // Enable Custom Mode + Lyrics sub-mode
    await this.enableCustomMode(page);
    await this.enableLyricsMode(page);

    // Debug: dump visible textareas before filling
    const textareas = await page.locator('textarea').all();
    for (const ta of textareas) {
      const ph = await ta.getAttribute('placeholder').catch(() => '');
      const vis = await ta.isVisible().catch(() => false);
      if (vis) logger.debug({ placeholder: ph }, 'Visible textarea found');
    }

    // Fill in the form fields
    logger.debug('Filling lyrics...');
    await this.fillLyrics(page, input.lyrics);
    logger.debug('Filling style...');
    await this.fillStyle(page, input.style);
    logger.debug('Filling title...');
    await this.fillTitle(page, input.title);

    // Screenshot before clicking Create
    await page.screenshot({ path: './media/debug/before-create.png' }).catch(() => {});
    logger.debug('Screenshot saved: before-create.png');

    // Click Create button
    await this.clickCreate(page);
    logger.debug('Create clicked, waiting for clip ID from network...');

    // Wait for clip ID from network intercept
    let clipId: string;
    try {
      clipId = await Promise.race([
        clipIdPromise,
        sleep(NETWORK_INTERCEPT_TIMEOUT_MS).then(() => { throw new SunoGenerationError('Timed out waiting for clip ID from network'); }),
      ]) as string;
    } catch (err) {
      throw new SunoGenerationError(`Failed to capture clip ID: ${String(err)}`);
    }

    logger.info({ clipId }, 'Clip ID captured, polling for completion');

    // Poll for audio availability
    const audioUrl = await this.pollForAudio(page, clipId);

    logger.info({ clipId, audioUrl }, 'Suno generation complete');
    return { clipId, audioUrl };
  }

  private async enableCustomMode(page: Page): Promise<void> {
    // Suno v5: "Custom" tab button in the top bar of create form
    try {
      const customBtn = page.locator('button:has-text("Custom")').first();
      await customBtn.waitFor({ state: 'visible', timeout: 10_000 });
      await customBtn.click();
      await sleep(1500);
      // Wait for the form to switch — at least one textarea should appear
      await page.waitForSelector('textarea', { state: 'visible', timeout: 8_000 }).catch(() => {});
      logger.debug('Custom mode enabled');
    } catch {
      logger.warn('Custom mode toggle not found — proceeding without enabling it');
    }
  }

  /**
   * In Custom mode, click "Lyrics" button to reveal the lyrics textarea.
   */
  private async enableLyricsMode(page: Page): Promise<void> {
    try {
      const lyricsBtn = page.locator('button:has-text("Lyrics")').first();
      const visible = await lyricsBtn.isVisible({ timeout: 3_000 }).catch(() => false);
      if (visible) {
        await lyricsBtn.click();
        await sleep(500);
        logger.debug('Lyrics mode enabled');
      }
    } catch {
      // Not critical — lyrics textarea might already be visible
    }
  }

  private async fillStyle(page: Page, style: string): Promise<void> {
    // Suno v5 Custom mode: the style textarea has a dynamic placeholder with
    // example styles (e.g. "only piano, slow start, shamisen, epic composition").
    // It's the second visible textarea (after lyrics). We also try known placeholders.
    const selectors = [
      'textarea[placeholder*="piano"]',
      'textarea[placeholder*="epic composition"]',
      'textarea[placeholder*="Describe the sound"]',
      'textarea[placeholder*="style"]',
      'textarea[placeholder*="Style"]',
    ];

    for (const selector of selectors) {
      const el = page.locator(selector).first();
      const visible = await el.isVisible({ timeout: 3_000 }).catch(() => false);
      if (visible) {
        await el.click();
        await el.fill(style);
        logger.debug({ style }, 'Style field filled');
        return;
      }
    }

    // Fallback: find the second visible textarea on the page (first is lyrics)
    const allTextareas = await page.locator('textarea').all();
    const visibleTextareas: typeof allTextareas = [];
    for (const ta of allTextareas) {
      if (await ta.isVisible().catch(() => false)) {
        visibleTextareas.push(ta);
      }
    }
    if (visibleTextareas.length >= 2) {
      const styleEl = visibleTextareas[1];
      await styleEl.click();
      await styleEl.fill(style);
      logger.debug({ style }, 'Style field filled (positional fallback, 2nd textarea)');
      return;
    }

    throw new SunoGenerationError('Could not find Style input field on Suno create page');
  }

  private async fillLyrics(page: Page, lyrics: string): Promise<void> {
    // Suno v5: "Write some lyrics or a prompt" textarea
    const selectors = [
      'textarea[placeholder*="Write some lyrics"]',
      'textarea[placeholder*="lyrics"]',
      'textarea[placeholder*="Lyrics"]',
    ];

    for (const selector of selectors) {
      const el = page.locator(selector).first();
      const visible = await el.isVisible({ timeout: 5_000 }).catch(() => false);
      if (visible) {
        await el.click();
        await el.fill(lyrics);
        logger.debug({ lyricsLength: lyrics.length }, 'Lyrics field filled');
        return;
      }
    }

    throw new SunoGenerationError('Could not find Lyrics input field on Suno create page');
  }

  private async fillTitle(page: Page, title: string): Promise<void> {
    // Suno v5 Custom mode: title input may be outside viewport — scroll to it
    const selectors = [
      'input[placeholder*="Song Title"]',
      'input[placeholder*="Title"]',
      'input[placeholder*="title"]',
    ];

    for (const selector of selectors) {
      const el = page.locator(selector).first();
      const count = await el.count();
      if (count > 0) {
        // Scroll into view even if not currently visible
        await el.scrollIntoViewIfNeeded().catch(() => {});
        await sleep(300);
        await el.click({ force: true });
        await el.fill(title);
        logger.info({ title, selector }, 'Title field filled');
        return;
      }
    }

    // Dump all inputs for debugging
    const allInputs = await page.locator('input').all();
    for (const inp of allInputs) {
      const ph = await inp.getAttribute('placeholder').catch(() => '');
      const type = await inp.getAttribute('type').catch(() => '');
      if (ph) logger.info({ placeholder: ph, type }, 'Found input element');
    }

    logger.warn('Title input not found — song will use Suno auto-title');
  }

  private async clickCreate(page: Page): Promise<void> {
    // Suno v5: "Create" button at the bottom of the form
    const createBtn = page.locator('button:has-text("Create")').first();
    const visible = await createBtn.isVisible({ timeout: 5_000 }).catch(() => false);

    if (visible) {
      await createBtn.click();
      logger.debug('Create button clicked');
      await sleep(3_000); // Wait for generation to start
      return;
    }

    throw new SunoGenerationError('Could not find Create button on Suno create page');
  }

  /**
   * Intercept Suno API network responses to capture the clip ID.
   * Returns a promise that resolves with the first clip ID found.
   */
  private interceptClipId(page: Page): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const handler = async (response: Response) => {
        const url = response.url();

        // Suno API endpoints that return clip IDs
        if (
          !url.includes('suno.com') ||
          (!url.includes('/generate') && !url.includes('/clips') && !url.includes('/songs'))
        ) {
          return;
        }

        logger.debug({ url, status: response.status() }, 'Intercepted Suno API response');

        if (response.status() < 200 || response.status() >= 300) {
          logger.warn({ url, status: response.status() }, 'Non-OK Suno API response');
          return;
        }

        try {
          const body = await response.json() as unknown;
          const obj = body as Record<string, unknown>;
          logger.info({
            url,
            topLevelId: obj.id,
            hasClips: Array.isArray(obj.clips),
            clipsCount: Array.isArray(obj.clips) ? obj.clips.length : 0,
            clipIds: Array.isArray(obj.clips) ? obj.clips.map((c: any) => c.id).filter(Boolean) : [],
            bodyKeys: Object.keys(obj),
          }, 'Suno API response parsed');
          const clipId = extractClipId(body);
          if (clipId) {
            logger.info({ clipId, url }, 'Clip ID extracted from network response');
            page.off('response', handler);
            resolve(clipId);
          }
        } catch {
          // Not JSON or no clip ID — continue listening
        }
      };

      page.on('response', handler);

      // Timeout cleanup
      setTimeout(() => {
        page.off('response', handler);
        reject(new SunoGenerationError('Network intercept timeout: no clip ID found'));
      }, NETWORK_INTERCEPT_TIMEOUT_MS);
    });
  }

  /**
   * Poll for audio availability on cdn1.suno.ai.
   * After generation, audio appears at https://cdn1.suno.ai/<clipId>.m4a
   * We poll with HEAD-like GET (abort after headers) until we get 200.
   */
  private async pollForAudio(_page: Page, clipId: string): Promise<string> {
    const audioUrl = `https://cdn1.suno.ai/${clipId}.mp3`;
    const deadline = Date.now() + GENERATION_TIMEOUT_MS;
    let attempt = 0;

    logger.info({ clipId, audioUrl, initialDelaySec: POLL_INITIAL_DELAY_MS / 1000 }, 'Starting audio poll (cdn1) — waiting before first check');

    await sleep(POLL_INITIAL_DELAY_MS);

    while (Date.now() < deadline) {
      attempt++;

      try {
        const response = await fetch(audioUrl, { method: 'HEAD' });
        const status = response.status;
        const contentLength = response.headers.get('content-length');
        logger.info({ clipId, attempt, status, contentLength }, 'Poll HEAD response');

        if (response.ok && contentLength && parseInt(contentLength, 10) > 50_000) {
          logger.info({ clipId, audioUrl, contentLength }, 'Audio ready for download');
          return audioUrl;
        }
      } catch (err) {
        logger.info({ clipId, attempt, error: String(err) }, 'Poll error');
      }

      const elapsed = Math.round((Date.now() - (deadline - GENERATION_TIMEOUT_MS)) / 1000);
      logger.info({ clipId, attempt, elapsedSeconds: elapsed }, 'Audio not ready yet, polling...');

      await sleep(POLL_INTERVAL_MS);
    }

    throw new SunoGenerationError(
      `Audio generation timed out after ${GENERATION_TIMEOUT_MS / 1000}s for clip ${clipId}`,
    );
  }
}

/** Extract clip ID from various Suno API response shapes. */
function extractClipId(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;

  const obj = body as Record<string, unknown>;

  // { clips: [{ id: "..." }] } — PREFERRED: clip ID from clips array
  if (Array.isArray(obj.clips) && obj.clips.length > 0) {
    const first = obj.clips[0] as Record<string, unknown>;
    if (typeof first.id === 'string') {
      logger.info({ clipId: first.id, batchId: obj.id, totalClips: obj.clips.length }, 'Extracted clip ID from clips array');
      return first.id;
    }
  }

  // { data: { clips: [{ id: "..." }] } }
  if (obj.data && typeof obj.data === 'object') {
    const data = obj.data as Record<string, unknown>;
    if (Array.isArray(data.clips) && data.clips.length > 0) {
      const first = data.clips[0] as Record<string, unknown>;
      if (typeof first.id === 'string') {
        logger.info({ clipId: first.id }, 'Extracted clip ID from data.clips');
        return first.id;
      }
    }
    if (typeof data.id === 'string') return data.id;
  }

  // Array of clips directly
  if (Array.isArray(body) && body.length > 0) {
    const first = body[0] as Record<string, unknown>;
    if (typeof first.id === 'string') return first.id;
  }

  // Fallback: top-level id (could be batch ID — log warning)
  if (typeof obj.id === 'string' && obj.id.length > 0) {
    logger.warn({ id: obj.id, hasClips: 'clips' in obj }, 'Using top-level id as clip ID (might be batch ID)');
    return obj.id;
  }

  return null;
}
