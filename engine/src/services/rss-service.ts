import Parser from 'rss-parser';
import { EventEmitter } from 'events';
import crypto from 'crypto';
import { eq, isNull, desc, and, gt, sql } from 'drizzle-orm';
import { logger } from '../utils/logger.js';
import { withRetry } from '../utils/retry.js';
import { getDb } from '../db/client.js';
import { articles as articlesTable } from '../db/schema.js';

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

/** Max age for articles to be considered fresh (48 hours) */
const MAX_ARTICLE_AGE_MS = 48 * 60 * 60 * 1000;

export interface RssServiceEvents {
  articles: (articles: NewsArticle[]) => void;
  error: (err: Error, feedName: string) => void;
}

export class RssService extends EventEmitter {
  private readonly parser: Parser;
  private readonly config: RssServiceConfig;
  private running = false;
  private pollTimer: NodeJS.Timeout | null = null;

  constructor(config: Partial<RssServiceConfig> = {}) {
    super();
    this.config = {
      feeds: config.feeds ?? DEFAULT_FEEDS,
      pollIntervalMs: config.pollIntervalMs ?? 5 * 60 * 1000,
      warKeywords: config.warKeywords ?? DEFAULT_WAR_KEYWORDS,
    };
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

  /**
   * Fetch all enabled feeds, persist new articles to DB.
   * Returns all newly fetched articles.
   */
  async fetchOnce(): Promise<NewsArticle[]> {
    const enabledFeeds = this.config.feeds.filter(f => f.enabled);
    const results = await Promise.allSettled(enabledFeeds.map(feed => this.fetchFeed(feed)));

    const allNew: NewsArticle[] = [];
    for (const result of results) {
      if (result.status === 'fulfilled') {
        allNew.push(...result.value);
      }
    }

    // Persist new articles to DB
    if (allNew.length > 0) {
      this.persistArticles(allNew);
    }

    const db = getDb();
    const totalStored = db.select({ count: sql<number>`count(*)` }).from(articlesTable).get();
    const unusedCount = db.select({ count: sql<number>`count(*)` }).from(articlesTable).where(isNull(articlesTable.usedAt)).get();

    logger.info(
      { newFetched: allNew.length, totalStored: totalStored?.count ?? 0, unused: unusedCount?.count ?? 0 },
      'RSS fetch complete',
    );

    return allNew;
  }

  /**
   * Get articles that haven't been used yet, ordered by newest first.
   * Only returns articles within maxAge (default 48h).
   */
  getUnusedArticles(maxAgeMs: number = MAX_ARTICLE_AGE_MS): NewsArticle[] {
    const db = getDb();
    const cutoff = new Date(Date.now() - maxAgeMs);

    const rows = db
      .select()
      .from(articlesTable)
      .where(
        and(
          isNull(articlesTable.usedAt),
          gt(articlesTable.fetchedAt, cutoff),
        ),
      )
      .orderBy(desc(articlesTable.fetchedAt))
      .all();

    return rows.map(row => ({
      id: row.id,
      source: row.source,
      title: row.title,
      description: row.description ?? '',
      link: row.link,
      publishedAt: row.publishedAt ?? row.fetchedAt,
      fetchedAt: row.fetchedAt,
    }));
  }

  /**
   * Mark articles as used (for song or podcast).
   */
  markArticlesUsed(
    articleIds: string[],
    usedFor: string,
    cycleNumber: number,
    storyHeadline: string,
  ): void {
    const db = getDb();
    const now = new Date();

    for (const id of articleIds) {
      db.update(articlesTable)
        .set({
          usedAt: now,
          usedFor,
          cycleNumber,
          storyHeadline,
        })
        .where(eq(articlesTable.id, id))
        .run();
    }

    logger.debug(
      { count: articleIds.length, usedFor, storyHeadline },
      'Articles marked as used',
    );
  }

  /**
   * Clean up old articles from DB.
   * - Used articles older than 7 days → delete
   * - Unused articles older than 48h → delete (stale)
   */
  cleanupOldArticles(): number {
    const db = getDb();
    const usedCutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const unusedCutoff = new Date(Date.now() - MAX_ARTICLE_AGE_MS);

    const result1 = db.delete(articlesTable)
      .where(
        and(
          sql`${articlesTable.usedAt} IS NOT NULL`,
          sql`${articlesTable.fetchedAt} < ${usedCutoff.getTime()}`,
        ),
      )
      .run();

    const result2 = db.delete(articlesTable)
      .where(
        and(
          isNull(articlesTable.usedAt),
          sql`${articlesTable.fetchedAt} < ${unusedCutoff.getTime()}`,
        ),
      )
      .run();

    const deleted = result1.changes + result2.changes;
    if (deleted > 0) {
      logger.info({ deleted }, 'Cleaned up old articles');
    }
    return deleted;
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

    const db = getDb();
    const articles: NewsArticle[] = [];

    for (const item of feedData.items) {
      const link = item.link ?? item.guid ?? '';
      if (!link) continue;

      const id = this.articleId(link);

      // Check if already in DB (persistent dedup)
      const existing = db.select({ id: articlesTable.id }).from(articlesTable).where(eq(articlesTable.id, id)).get();
      if (existing) continue;

      const title = item.title ?? '';
      const description = item.contentSnippet ?? item.content ?? item.summary ?? '';

      if (!this.matchesWarKeywords(title, description)) continue;

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

  private persistArticles(newArticles: NewsArticle[]): void {
    const db = getDb();

    for (const article of newArticles) {
      try {
        db.insert(articlesTable)
          .values({
            id: article.id,
            link: article.link,
            title: article.title,
            source: article.source,
            description: article.description,
            publishedAt: article.publishedAt,
            fetchedAt: article.fetchedAt,
          })
          .onConflictDoNothing()
          .run();
      } catch {
        // Ignore duplicate insert errors
      }
    }
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
