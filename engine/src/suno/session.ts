import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { promises as fs } from 'fs';
import path from 'path';
import { getConfig } from '../config.js';
import { logger } from '../utils/logger.js';
import { sleep } from '../utils/sleep.js';

const SUNO_BASE_URL = 'https://suno.com';
const TOKEN_REFRESH_INTERVAL_MS = 45 * 60 * 1000; // 45 minutes
const CUSTOM_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

export class SunoSession {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private tokenRefreshTimer: NodeJS.Timeout | null = null;
  private sessionPath: string;

  constructor() {
    this.sessionPath = getConfig().SESSION_PATH;
  }

  /** Initialize browser and load existing session state from disk. */
  async initialize(headless = true, slowMo = 0): Promise<void> {
    logger.info({ headless, slowMo, sessionPath: this.sessionPath }, 'Initializing Suno browser session');

    const storageState = await this.loadStorageState();

    this.browser = await chromium.launch({
      headless,
      slowMo,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--disable-infobars',
        '--window-size=1280,800',
      ],
    });

    this.context = await this.browser.newContext({
      userAgent: CUSTOM_USER_AGENT,
      storageState: (storageState as any) ?? undefined,
      viewport: { width: 1280, height: 800 },
      locale: 'en-US',
      timezoneId: 'America/New_York',
      extraHTTPHeaders: {
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });

    // Anti-detection: remove navigator.webdriver flag
    await this.context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (globalThis as any).chrome = { runtime: {} };
    });

    this.scheduleTokenRefresh();

    logger.info('Suno browser session initialized');
  }

  /** Open a new page in the current context. */
  async newPage(): Promise<Page> {
    if (!this.context) {
      throw new Error('Session not initialized. Call initialize() first.');
    }
    return this.context.newPage();
  }

  /** Verify the session is still authenticated by checking the Suno home page. */
  async verifySession(): Promise<boolean> {
    if (!this.context) return false;

    let page: Page | null = null;
    try {
      page = await this.context.newPage();
      await page.goto(`${SUNO_BASE_URL}/`, { waitUntil: 'domcontentloaded', timeout: 30_000 });

      // Check for authenticated state: user avatar or "Create" button in nav
      const isAuthed = await page.locator('[data-testid="user-avatar"], button:has-text("Create")').first().isVisible({ timeout: 5000 }).catch(() => false);

      // Also check we're not on a login page
      const isLoginPage = await page.locator('input[type="email"], button:has-text("Sign in")').first().isVisible({ timeout: 3000 }).catch(() => false);

      logger.info({ isAuthed, isLoginPage }, 'Session verification result');
      return isAuthed && !isLoginPage;
    } catch (err) {
      logger.warn({ err }, 'Session verification failed');
      return false;
    } finally {
      if (page) await page.close().catch(() => undefined);
    }
  }

  /** Refresh Clerk/auth tokens by navigating to suno and triggering a token refresh. */
  async refreshToken(): Promise<void> {
    if (!this.context) return;

    logger.info('Refreshing Suno auth tokens');
    let page: Page | null = null;
    try {
      page = await this.context.newPage();
      await page.goto(`${SUNO_BASE_URL}/`, { waitUntil: 'networkidle', timeout: 30_000 });
      // Save updated cookies/storage state
      await this.saveStorageState();
      logger.info('Suno auth tokens refreshed');
    } catch (err) {
      logger.warn({ err }, 'Token refresh failed');
    } finally {
      if (page) await page.close().catch(() => undefined);
    }
  }

  /** Save current browser storage state to disk for session persistence. */
  async saveStorageState(): Promise<void> {
    if (!this.context) return;
    const dir = path.dirname(this.sessionPath);
    await fs.mkdir(dir, { recursive: true });
    await this.context.storageState({ path: this.sessionPath });
    logger.debug({ path: this.sessionPath }, 'Storage state saved');
  }

  /** Close the browser and clean up resources. */
  async destroy(): Promise<void> {
    if (this.tokenRefreshTimer) {
      clearInterval(this.tokenRefreshTimer);
      this.tokenRefreshTimer = null;
    }

    try {
      await this.saveStorageState();
    } catch (err) {
      logger.warn({ err }, 'Failed to save storage state on destroy');
    }

    if (this.context) {
      await this.context.close().catch(() => undefined);
      this.context = null;
    }

    if (this.browser) {
      await this.browser.close().catch(() => undefined);
      this.browser = null;
    }

    logger.info('Suno browser session destroyed');
  }

  private scheduleTokenRefresh(): void {
    this.tokenRefreshTimer = setInterval(() => {
      void this.refreshToken();
    }, TOKEN_REFRESH_INTERVAL_MS);
  }

  private async loadStorageState(): Promise<object | null> {
    try {
      const raw = await fs.readFile(this.sessionPath, 'utf-8');
      const state = JSON.parse(raw) as object;
      logger.info({ path: this.sessionPath }, 'Loaded existing session storage state');
      return state;
    } catch {
      logger.warn({ path: this.sessionPath }, 'No existing session state found — starting fresh');
      return null;
    }
  }
}
