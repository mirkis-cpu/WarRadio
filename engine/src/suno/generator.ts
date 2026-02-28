import type { Page, Response } from 'playwright';
import { logger } from '../utils/logger.js';
import { sleep } from '../utils/sleep.js';
import { withRetry } from '../utils/retry.js';
import { handleCaptcha } from './captcha.js';
import type { SunoSession } from './session.js';

const SUNO_CREATE_URL = 'https://suno.com/create';
const GENERATION_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const POLL_INTERVAL_MS = 5_000;
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

    // Navigate to create page
    await page.goto(SUNO_CREATE_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await sleep(2_000);

    // Handle captcha if present
    await handleCaptcha(page);

    // Enable Custom Mode
    await this.enableCustomMode(page);

    // Fill in the form fields
    await this.fillStyle(page, input.style);
    await this.fillLyrics(page, input.lyrics);
    await this.fillTitle(page, input.title);

    // Click Create button
    await this.clickCreate(page);

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
    // Look for "Custom Mode" toggle or button
    const customModeSelectors = [
      'button:has-text("Custom")',
      '[data-testid="custom-mode-toggle"]',
      'label:has-text("Custom")',
    ];

    for (const selector of customModeSelectors) {
      const el = page.locator(selector).first();
      const visible = await el.isVisible({ timeout: 3_000 }).catch(() => false);
      if (visible) {
        await el.click();
        await sleep(500);
        logger.debug('Custom mode enabled');
        return;
      }
    }

    logger.warn('Custom mode toggle not found — proceeding without enabling it');
  }

  private async fillStyle(page: Page, style: string): Promise<void> {
    const selectors = [
      'textarea[placeholder*="Style"]',
      'textarea[placeholder*="style"]',
      '[data-testid="style-input"] textarea',
      '[aria-label*="style" i] textarea',
      'textarea[name="style"]',
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

    throw new SunoGenerationError('Could not find Style input field on Suno create page');
  }

  private async fillLyrics(page: Page, lyrics: string): Promise<void> {
    const selectors = [
      'textarea[placeholder*="Lyrics"]',
      'textarea[placeholder*="lyrics"]',
      '[data-testid="lyrics-input"] textarea',
      '[aria-label*="lyrics" i] textarea',
      'textarea[name="lyrics"]',
    ];

    for (const selector of selectors) {
      const el = page.locator(selector).first();
      const visible = await el.isVisible({ timeout: 3_000 }).catch(() => false);
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
    const selectors = [
      'input[placeholder*="Title"]',
      'input[placeholder*="title"]',
      '[data-testid="title-input"] input',
      '[aria-label*="title" i] input',
      'input[name="title"]',
    ];

    for (const selector of selectors) {
      const el = page.locator(selector).first();
      const visible = await el.isVisible({ timeout: 3_000 }).catch(() => false);
      if (visible) {
        await el.click();
        await el.fill(title);
        logger.debug({ title }, 'Title field filled');
        return;
      }
    }

    // Title is optional — log warning and continue
    logger.warn('Could not find Title input field — skipping title fill');
  }

  private async clickCreate(page: Page): Promise<void> {
    const selectors = [
      'button:has-text("Create")',
      '[data-testid="create-button"]',
      'button[type="submit"]:has-text("Create")',
    ];

    for (const selector of selectors) {
      const el = page.locator(selector).first();
      const visible = await el.isVisible({ timeout: 3_000 }).catch(() => false);
      if (visible) {
        await el.click();
        logger.debug('Create button clicked');
        await sleep(2_000);
        return;
      }
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

        if (response.status() < 200 || response.status() >= 300) return;

        try {
          const body = await response.json() as unknown;
          const clipId = extractClipId(body);
          if (clipId) {
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
   * Poll for audio availability by checking the page DOM for an audio element
   * or by checking the Suno API for clip completion status.
   */
  private async pollForAudio(page: Page, clipId: string): Promise<string> {
    const deadline = Date.now() + GENERATION_TIMEOUT_MS;

    while (Date.now() < deadline) {
      await sleep(POLL_INTERVAL_MS);

      // Check for audio element on page
      const audioUrl = await this.findAudioUrl(page, clipId);
      if (audioUrl) {
        return audioUrl;
      }

      const elapsed = Math.round((Date.now() - (deadline - GENERATION_TIMEOUT_MS)) / 1000);
      logger.debug({ clipId, elapsedSeconds: elapsed }, 'Polling for audio completion...');
    }

    throw new SunoGenerationError(
      `Audio generation timed out after ${GENERATION_TIMEOUT_MS / 1000}s for clip ${clipId}`,
    );
  }

  private async findAudioUrl(page: Page, clipId: string): Promise<string | null> {
    try {
      // Try to find a direct audio element on the page
      const audioEl = page.locator(`audio[src*="${clipId}"], audio`).first();
      const audioSrc = await audioEl.getAttribute('src').catch(() => null);
      if (audioSrc && audioSrc.startsWith('http')) {
        return audioSrc;
      }

      // Try to find a download link
      const downloadLink = page.locator(`a[href*="${clipId}"][href*=".mp3"], a[download][href*="${clipId}"]`).first();
      const href = await downloadLink.getAttribute('href').catch(() => null);
      if (href && href.startsWith('http')) {
        return href;
      }

      // Check if the clip URL pattern is known (Suno CDN pattern)
      const cdnUrl = await page.evaluate((id: string) => {
        const audioElements = Array.from(document.querySelectorAll('audio'));
        for (const audio of audioElements) {
          if (audio.src && audio.src.includes(id)) return audio.src;
        }
        return null;
      }, clipId);

      return cdnUrl;
    } catch {
      return null;
    }
  }
}

/** Extract clip ID from various Suno API response shapes. */
function extractClipId(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;

  const obj = body as Record<string, unknown>;

  // { id: "...", clips: [...] }
  if (typeof obj.id === 'string' && obj.id.length > 0) return obj.id;

  // { clips: [{ id: "..." }] }
  if (Array.isArray(obj.clips) && obj.clips.length > 0) {
    const first = obj.clips[0] as Record<string, unknown>;
    if (typeof first.id === 'string') return first.id;
  }

  // { data: { id: "..." } }
  if (obj.data && typeof obj.data === 'object') {
    const data = obj.data as Record<string, unknown>;
    if (typeof data.id === 'string') return data.id;
  }

  // Array of clips directly
  if (Array.isArray(body) && body.length > 0) {
    const first = body[0] as Record<string, unknown>;
    if (typeof first.id === 'string') return first.id;
  }

  return null;
}
