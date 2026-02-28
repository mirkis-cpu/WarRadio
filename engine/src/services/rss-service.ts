import Parser from 'rss-parser';
import { EventEmitter } from 'events';
import crypto from 'crypto';
import { logger } from '../utils/logger.js';
import { withRetry } from '../utils/retry.js';
import { sleep } from '../utils/sleep.js';

export interface NewsArticle {
  id: string;
  source: string;
  title: string;
  description: string;
  link: string;
  publishedAt: Date;
  fetchedAt: Date;
}

export interface FeedConfig {
  url: string;
  name: string;
  enabled: boolean;
}

export interface RssServiceConfig {
  feeds: FeedConfig[];
  pollIntervalMs: number;
  warKeywords: string[];
  maxSeenIds: number;
}

const DEFAULT_WAR_KEYWORDS = [
  'war', 'conflict', 'military', 'combat', 'battle', 'attack', 'strike',
  'missile', 'drone', 'troops', 'soldiers', 'army', 'navy', 'air force',
  'casualty', 'casualties', 'killed', 'wounded', 'ceasefire', 'offensive',
  'invasion', 'occupation', 'siege', 'bombardment', 'shelling', 'airstrike',
  'nato', 'ukraine', 'russia', 'gaza', 'israel', 'hamas', 'hezbollah',
  'pentagon', 'defense', 'defence', 'weapon', 'warzone', 'frontline',
  'refugee', 'displaced', 'humanitarian', 'sanction', 'blockade',
];

const DEFAULT_FEEDS: FeedConfig[] = [
  { url: 'https://rss.nytimes.com/services/xml/rss/nyt/World.xml', name: 'NYT World', enabled: true },
  { url: 'https://feeds.bbci.co.uk/news/world/rss.xml', name: 'BBC World', enabled: true },
  { url: 'https://www.aljazeera.com/xml/rss/all.xml', name: 'Al Jazeera', enabled: true },
  { url: 'https://feeds.theguardian.com/theguardian/world/rss', name: 'Guardian World', enabled: true },
  { url: 'https://rss.dw.com/xml/rss-en-world', name: 'DW World', enabled: true },
  { url: 'https://news.google.com/rss/search?q=war+OR+conflict+OR+military&hl=en-US&gl=US&ceid=US:en', name: 'Google News War', enabled: true },
];

const SEEN_IDS_MAX_DEFAULT = 5000;

/** Simple LRU eviction: remove oldest entries when Set exceeds max size. */
class BoundedSet<T> {
  private readonly store: Map<T, number>;
  private readonly maxSize: number;
  private counter = 0;

  constructor(maxSize: number) {
    this.maxSize = maxSize;
    this.store = new Map();
  }

  has(value: T): boolean {
    return this.store.has(value);
  }

  add(value: T): void {
    if (this.store.has(value)) return;

    if (this.store.size >= this.maxSize) {
      // Evict oldest entry (smallest counter)
      let oldestKey: T | undefined;
      let oldestCounter = Infinity;
      for (const [k, c] of this.store) {
        if (c < oldestCounter) {
          oldestCounter = c;
          oldestKey = k;
        }
      }
      if (oldestKey !== undefined) {
        this.store.delete(oldestKey);
      }
    }

    this.store.set(value, this.counter++);
  }

  get size(): number {
    return this.store.size;
  }
}

export interface RssServiceEvents {
  articles: (articles: NewsArticle[]) => void;
  error: (err: Error, feedName: string) => void;
}

export class RssService extends EventEmitter {
  private readonly parser: Parser;
  private readonly config: RssServiceConfig;
  private readonly seenIds: BoundedSet<string>;
  private running = false;
  private pollTimer: NodeJS.Timeout | null = null;

  constructor(config: Partial<RssServiceConfig> = {}) {
    super();
    this.config = {
      feeds: config.feeds ?? DEFAULT_FEEDS,
      pollIntervalMs: config.pollIntervalMs ?? 5 * 60 * 1000, // 5 minutes
      warKeywords: config.warKeywords ?? DEFAULT_WAR_KEYWORDS,
      maxSeenIds: config.maxSeenIds ?? SEEN_IDS_MAX_DEFAULT,
    };
    this.seenIds = new BoundedSet(this.config.maxSeenIds);
    this.parser = new Parser({
      timeout: 15_000,
      headers: {
        'User-Agent': 'RadioWar/1.0 (+https://github.com/radiowar)',
        'Accept': 'application/rss+xml, application/xml, text/xml',
      },
    });
  }

  /** Start polling all enabled feeds. */
  start(): void {
    if (this.running) return;
    this.running = true;
    logger.info({ feedCount: this.config.feeds.filter(f => f.enabled).length }, 'RSS service started');
    void this.poll();
  }

  /** Stop polling. */
  stop(): void {
    this.running = false;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
    logger.info('RSS service stopped');
  }

  /** Fetch all enabled feeds once and return new articles. */
  async fetchOnce(): Promise<NewsArticle[]> {
    const enabledFeeds = this.config.feeds.filter(f => f.enabled);
    const results = await Promise.allSettled(enabledFeeds.map(feed => this.fetchFeed(feed)));

    const allNew: NewsArticle[] = [];
    for (const result of results) {
      if (result.status === 'fulfilled') {
        allNew.push(...result.value);
      }
    }

    logger.info({ count: allNew.length, seenTotal: this.seenIds.size }, 'RSS fetch complete');
    return allNew;
  }

  private async poll(): Promise<void> {
    try {
      const newArticles = await this.fetchOnce();
      if (newArticles.length > 0) {
        this.emit('articles', newArticles);
      }
    } catch (err) {
      logger.error({ err }, 'RSS poll cycle error');
    }

    if (this.running) {
      this.pollTimer = setTimeout(() => { void this.poll(); }, this.config.pollIntervalMs);
    }
  }

  private async fetchFeed(feed: FeedConfig): Promise<NewsArticle[]> {
    const fetchedAt = new Date();

    const feedData = await withRetry(
      () => this.parser.parseURL(feed.url),
      { maxAttempts: 3, baseDelay: 2000, label: `rss:${feed.name}` },
    );

    const articles: NewsArticle[] = [];

    for (const item of feedData.items) {
      const link = item.link ?? item.guid ?? '';
      if (!link) continue;

      const id = this.articleId(link);
      if (this.seenIds.has(id)) continue;

      const title = item.title ?? '';
      const description = item.contentSnippet ?? item.content ?? item.summary ?? '';

      if (!this.matchesWarKeywords(title, description)) continue;

      this.seenIds.add(id);

      articles.push({
        id,
        source: feed.name,
        title: title.trim(),
        description: description.trim(),
        link,
        publishedAt: item.isoDate ? new Date(item.isoDate) : fetchedAt,
        fetchedAt,
      });
    }

    logger.debug({ feed: feed.name, newArticles: articles.length }, 'Feed fetched');
    return articles;
  }

  private articleId(link: string): string {
    return crypto.createHash('sha256').update(link).digest('hex').slice(0, 16);
  }

  private matchesWarKeywords(title: string, description: string): boolean {
    const haystack = `${title} ${description}`.toLowerCase();
    return this.config.warKeywords.some(kw => haystack.includes(kw.toLowerCase()));
  }

  /** Update feed list at runtime without restarting. */
  setFeeds(feeds: FeedConfig[]): void {
    this.config.feeds = feeds;
    logger.info({ feedCount: feeds.filter(f => f.enabled).length }, 'RSS feeds updated');
  }

  /** Update keyword filter at runtime. */
  setWarKeywords(keywords: string[]): void {
    this.config.warKeywords = keywords;
    logger.info({ keywordCount: keywords.length }, 'RSS war keywords updated');
  }
}
