import path from 'path';
import { existsSync, mkdirSync, readdirSync, statSync } from 'fs';
import { nanoid } from 'nanoid';
import { desc, eq, sql } from 'drizzle-orm';
import { getConfig } from '../config.js';
import { logger } from '../utils/logger.js';
import { sleep } from '../utils/sleep.js';
import { getDb } from '../db/client.js';
import { audioTracks } from '../db/schema.js';
import { RssService, type NewsArticle } from './rss-service.js';
import { LyricsService, type GeneratedLyrics, type SynthesizedStory } from './lyrics-service.js';
import { TtsService } from './tts-service.js';
import { PodcastService } from './podcast-service.js';
import { SunoApiGenerator, type SunoApiResult } from '../suno/api-generator.js';
import { downloadAudio } from '../suno/downloader.js';
import { StreamManager, type StreamStatus } from './stream-manager.js';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** How many songs to generate per cycle.
 *  Budget: ~$30/month via sunoapi.org ($0.005/credit, ~12 credits/song = $0.06/song)
 *  4 cycles/day × 4 songs = 16 songs/day = 480/month = ~$29/month
 *  Each API call produces 2 songs, so 4 songs = 2 API calls per cycle.
 */
const SONGS_PER_CYCLE = 4;

/** Interval between production cycles (4x/day = every 6 hours) */
const CYCLE_INTERVAL_MS = 6 * 60 * 60 * 1000;

/** Max concurrent Suno API requests (API limit: 20 req / 10s, but we stay conservative) */
const SUNO_CONCURRENCY = 2;

/** News block (TTS) interval */
const NEWS_BLOCK_INTERVAL_MS = 15 * 60 * 1000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Get date-based subdirectory, creating it if needed. E.g. /app/media/songs/2026-03-02/ */
function getDateDir(baseDir: string): string {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const dir = path.join(baseDir, today);
  mkdirSync(dir, { recursive: true });
  return dir;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AudioBufferEntry {
  id: string;
  type: 'song' | 'news_block' | 'podcast';
  title: string;
  filePath: string;
  durationSeconds?: number;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

export interface PipelineStatus {
  running: boolean;
  cycleNumber: number;
  lastCycleAt: Date | null;
  nextCycleAt: Date | null;
  audioBufferSize: number;
  pendingGeneration: number;
  totalSongsGenerated: number;
  totalNewsBlocksGenerated: number;
  totalPodcastsGenerated: number;
  currentPhase: string;
  stream: StreamStatus | null;
}

export interface CycleResult {
  articlesScraped: number;
  storiesSynthesized: number;
  lyricsGenerated: number;
  songsProduced: number;
  podcastsProduced: number;
  errors: string[];
}

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------

export class Pipeline {
  private readonly rssService: RssService;
  private readonly lyricsService: LyricsService;
  private readonly ttsService: TtsService;
  private readonly podcastService: PodcastService;
  private sunoGenerator: SunoApiGenerator | null = null;
  private streamManager: StreamManager | null = null;

  /** Queue of tracks to play — new songs go here first */
  private readonly audioBuffer: AudioBufferEntry[] = [];
  /** Archive of all played tracks — used for looping when buffer is empty */
  private readonly playedArchive: AudioBufferEntry[] = [];
  /** Position in the archive for round-robin replay */
  private archivePosition = 0;

  private running = false;
  private pendingGeneration = 0;
  private cycleNumber = 0;
  private lastCycleAt: Date | null = null;
  private nextCycleAt: Date | null = null;
  private totalSongsGenerated = 0;
  private totalNewsBlocksGenerated = 0;
  private totalPodcastsGenerated = 0;
  private currentPhase = 'idle';
  private cycleTimer: NodeJS.Timeout | null = null;
  private newsBlockTimer: NodeJS.Timeout | null = null;

  constructor() {
    this.rssService = new RssService();
    this.lyricsService = new LyricsService();
    this.ttsService = new TtsService();
    this.podcastService = new PodcastService(this.ttsService);
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  async start(): Promise<void> {
    if (this.running) {
      logger.warn('Pipeline already running');
      return;
    }

    this.running = true;
    this.currentPhase = 'initializing';
    logger.info('Pipeline starting');

    // Restore tracks from DB (so stream can start immediately)
    this.restoreTracksFromDb();

    // Initialize Suno API generator
    this.initSunoApi();

    // Schedule periodic news blocks via TTS
    this.newsBlockTimer = setInterval(() => {
      void this.generateNewsBlock();
    }, NEWS_BLOCK_INTERVAL_MS);

    // Start RTMP stream if YouTube is configured
    await this.initStream();

    // Run first cycle immediately, then schedule repeats
    logger.info('Pipeline running — starting first production cycle');
    void this.runCycleLoop();
  }

  async stop(): Promise<void> {
    this.running = false;
    this.currentPhase = 'stopping';

    // Stop stream
    if (this.streamManager) {
      this.streamManager.stop();
      this.streamManager = null;
    }

    if (this.cycleTimer) {
      clearTimeout(this.cycleTimer);
      this.cycleTimer = null;
    }

    if (this.newsBlockTimer) {
      clearInterval(this.newsBlockTimer);
      this.newsBlockTimer = null;
    }

    this.sunoGenerator = null;

    this.currentPhase = 'idle';
    logger.info('Pipeline stopped');
  }

  getStatus(): PipelineStatus {
    return {
      running: this.running,
      cycleNumber: this.cycleNumber,
      lastCycleAt: this.lastCycleAt,
      nextCycleAt: this.nextCycleAt,
      audioBufferSize: this.audioBuffer.length,
      pendingGeneration: this.pendingGeneration,
      totalSongsGenerated: this.totalSongsGenerated,
      totalNewsBlocksGenerated: this.totalNewsBlocksGenerated,
      totalPodcastsGenerated: this.totalPodcastsGenerated,
      currentPhase: this.currentPhase,
      stream: this.streamManager?.getStatus() ?? null,
    };
  }

  /**
   * Get next track to play.
   * Priority: new tracks from buffer first, then loop through archive.
   */
  dequeueAudio(): AudioBufferEntry | null {
    // 1. Fresh tracks have priority
    if (this.audioBuffer.length > 0) {
      const track = this.audioBuffer.shift()!;
      // Archive songs and podcasts for replay (not news blocks — those are time-sensitive)
      if (track.type === 'song' || track.type === 'podcast') {
        this.playedArchive.push(track);
      }
      this.updatePlayCount(track.id);
      return track;
    }

    // 2. Loop through archive when no new tracks
    if (this.playedArchive.length === 0) {
      return null;
    }

    const track = this.playedArchive[this.archivePosition % this.playedArchive.length];
    this.archivePosition++;
    this.updatePlayCount(track.id);
    return track;
  }

  peekBuffer(): AudioBufferEntry[] {
    return [...this.audioBuffer];
  }

  /**
   * Persist an audio track entry to the database.
   */
  private persistTrack(entry: AudioBufferEntry, cycleNumber?: number): void {
    try {
      const db = getDb();
      db.insert(audioTracks)
        .values({
          id: entry.id,
          type: entry.type,
          title: entry.title,
          filePath: entry.filePath,
          durationSeconds: entry.durationSeconds,
          metadata: entry.metadata,
          createdAt: entry.createdAt,
          cycleNumber: cycleNumber ?? this.cycleNumber,
        })
        .onConflictDoNothing()
        .run();
    } catch {
      // Ignore duplicate inserts
    }
  }

  /**
   * Update play count in DB after a track is played.
   */
  private updatePlayCount(trackId: string): void {
    try {
      const db = getDb();
      db.update(audioTracks)
        .set({
          playCount: sql`${audioTracks.playCount} + 1`,
          lastPlayedAt: new Date(),
        })
        .where(eq(audioTracks.id, trackId))
        .run();
    } catch {
      // Non-critical, don't crash
    }
  }

  /**
   * Restore audio buffer from DB on startup.
   * Loads tracks that still exist on disk, sorted by newest first.
   * Podcasts and songs go into archive for looping; fresh tracks (<24h) to buffer.
   */
  private restoreTracksFromDb(): void {
    const db = getDb();
    const rows = db
      .select()
      .from(audioTracks)
      .orderBy(desc(audioTracks.createdAt))
      .all();

    const now = Date.now();
    const freshThreshold = 24 * 60 * 60 * 1000; // 24h
    let restored = 0;

    for (const row of rows) {
      if (!existsSync(row.filePath)) continue;

      const entry: AudioBufferEntry = {
        id: row.id,
        type: row.type as AudioBufferEntry['type'],
        title: row.title,
        filePath: row.filePath,
        durationSeconds: row.durationSeconds ?? undefined,
        metadata: (row.metadata as Record<string, unknown>) ?? {},
        createdAt: row.createdAt,
      };

      const age = now - row.createdAt.getTime();

      if (age < freshThreshold) {
        // Fresh tracks go to buffer (will be played first)
        this.audioBuffer.push(entry);
      } else if (row.type === 'song' || row.type === 'podcast') {
        // Older songs/podcasts go to archive for looping
        this.playedArchive.push(entry);
      }
      // Skip old news_blocks — they're stale

      restored++;
    }

    // If DB was empty, scan disk for legacy files and import them
    if (rows.length === 0) {
      this.importLegacyFiles();
    }

    if (restored > 0) {
      logger.info(
        { restored, buffer: this.audioBuffer.length, archive: this.playedArchive.length },
        'Audio tracks restored from DB',
      );
    }
  }

  /**
   * One-time import of existing audio files from disk into DB.
   * Scans songs/ and podcasts/ directories (including date subdirs).
   */
  private importLegacyFiles(): void {
    const config = getConfig();
    const db = getDb();
    let imported = 0;

    for (const [subdir, type] of [['songs', 'song'], ['podcasts', 'podcast']] as const) {
      const baseDir = path.join(config.MEDIA_DIR, subdir);
      if (!existsSync(baseDir)) continue;

      const scanDir = (dir: string) => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          if (entry.isDirectory()) {
            scanDir(path.join(dir, entry.name));
          } else if (entry.name.endsWith('.mp3')) {
            const filePath = path.join(dir, entry.name);
            const id = entry.name.replace('.mp3', '');
            const stat = statSync(filePath);

            const audioEntry: AudioBufferEntry = {
              id,
              type,
              title: `Legacy ${type}: ${id}`,
              filePath,
              metadata: {},
              createdAt: stat.mtime,
            };

            this.persistTrack(audioEntry, 0);
            this.playedArchive.push(audioEntry);
            imported++;
          }
        }
      };

      scanDir(baseDir);
    }

    if (imported > 0) {
      logger.info(
        { imported, archive: this.playedArchive.length },
        'Legacy audio files imported from disk',
      );
    }
  }

  /**
   * Run a single production cycle manually (for testing).
   */
  async runSingleCycle(): Promise<CycleResult> {
    return this.runProductionCycle();
  }

  // ---------------------------------------------------------------------------
  // Production cycle loop
  // ---------------------------------------------------------------------------

  private async runCycleLoop(): Promise<void> {
    while (this.running) {
      try {
        const result = await this.runProductionCycle();
        logger.info(
          {
            cycle: this.cycleNumber,
            scraped: result.articlesScraped,
            stories: result.storiesSynthesized,
            lyrics: result.lyricsGenerated,
            songs: result.songsProduced,
            podcasts: result.podcastsProduced,
            errors: result.errors.length,
          },
          'Production cycle complete',
        );
      } catch (err) {
        logger.error({ err, cycle: this.cycleNumber }, 'Production cycle failed');
      }

      if (!this.running) break;

      // Schedule next cycle
      this.nextCycleAt = new Date(Date.now() + CYCLE_INTERVAL_MS);
      logger.info(
        { nextCycleAt: this.nextCycleAt.toISOString() },
        `Next production cycle in ${CYCLE_INTERVAL_MS / 60000} minutes`,
      );

      await sleep(CYCLE_INTERVAL_MS);
    }
  }

  // ---------------------------------------------------------------------------
  // Single production cycle: Scrape → Synthesize → Lyrics → Songs
  // ---------------------------------------------------------------------------

  private async runProductionCycle(): Promise<CycleResult> {
    this.cycleNumber++;
    this.lastCycleAt = new Date();
    const errors: string[] = [];

    // ── Phase 1: RSS Fetch + Get Unused Articles ──────────────────────────
    this.currentPhase = 'scraping';
    logger.info({ cycle: this.cycleNumber }, 'Phase 1: Fetching RSS feeds');

    try {
      await this.rssService.fetchOnce();
    } catch (err) {
      const msg = `RSS fetch failed: ${String(err)}`;
      logger.error({ err }, msg);
      errors.push(msg);
    }

    // Clean up old articles periodically
    this.rssService.cleanupOldArticles();

    // Get only unused, fresh articles for synthesis
    const articles = this.rssService.getUnusedArticles();
    logger.info({ unusedArticleCount: articles.length }, 'Unused articles available');

    if (articles.length === 0) {
      logger.warn('No unused articles available — skipping cycle');
      this.currentPhase = 'idle';
      return { articlesScraped: 0, storiesSynthesized: 0, lyricsGenerated: 0, songsProduced: 0, podcastsProduced: 0, errors };
    }

    // ── Phase 2: AI News Synthesis (1 Claude call) ──────────────────────────
    this.currentPhase = 'synthesizing';
    logger.info({ cycle: this.cycleNumber }, 'Phase 2: Synthesizing news into stories');

    let stories: SynthesizedStory[] = [];
    try {
      stories = await this.lyricsService.synthesizeNews(articles, SONGS_PER_CYCLE);
    } catch (err) {
      const msg = `News synthesis failed: ${String(err)}`;
      logger.error({ err }, msg);
      errors.push(msg);
      this.currentPhase = 'idle';
      return { articlesScraped: articles.length, storiesSynthesized: 0, lyricsGenerated: 0, songsProduced: 0, podcastsProduced: 0, errors };
    }

    // Mark all used articles in DB
    for (const story of stories) {
      if (story.sourceArticleIds.length > 0) {
        this.rssService.markArticlesUsed(
          story.sourceArticleIds,
          'synthesis',
          this.cycleNumber,
          story.headline,
        );
      }
    }

    logger.info(
      { storyCount: stories.length, headlines: stories.map((s) => s.headline) },
      'News synthesis complete',
    );

    // ── Phase 2.5: Podcast Generation (optional) ────────────────────────────
    let podcastsProduced = 0;

    if (getConfig().PODCAST_ENABLED && stories.length > 0) {
      this.currentPhase = 'podcast';
      logger.info({ cycle: this.cycleNumber }, 'Phase 2.5: Generating podcast episode');

      try {
        const episode = await this.podcastService.generateEpisode(stories);

        const entry: AudioBufferEntry = {
          id: episode.id,
          type: 'podcast',
          title: episode.title,
          filePath: episode.audioPath,
          metadata: {
            storyCount: episode.storyCount,
            scriptLength: episode.scriptText.length,
            durationEstimate: episode.durationEstimateMinutes,
          },
          createdAt: episode.generatedAt,
        };

        // Insert podcast at the beginning of the buffer so it plays first
        this.audioBuffer.unshift(entry);
        this.persistTrack(entry);
        this.totalPodcastsGenerated++;
        podcastsProduced = 1;

        logger.info(
          { title: episode.title, durationEstimate: episode.durationEstimateMinutes },
          'Podcast episode added to buffer',
        );
      } catch (err) {
        const msg = `Podcast generation failed: ${String(err)}`;
        logger.error({ err }, msg);
        errors.push(msg);
      }
    }

    // ── Phase 3: Batch Lyrics Generation (parallel Claude calls) ────────────
    this.currentPhase = 'lyrics';
    logger.info({ cycle: this.cycleNumber }, 'Phase 3: Generating lyrics');

    let allLyrics: GeneratedLyrics[] = [];
    try {
      allLyrics = await this.lyricsService.batchGenerateLyrics(stories);
    } catch (err) {
      const msg = `Batch lyrics failed: ${String(err)}`;
      logger.error({ err }, msg);
      errors.push(msg);
    }

    logger.info(
      { lyricsCount: allLyrics.length, titles: allLyrics.map((l) => `${l.title} (${l.genre.name})`) },
      'Lyrics generation complete',
    );

    // ── Phase 4: Suno Song Generation (2 at a time) ─────────────────────────
    this.currentPhase = 'generating_songs';
    logger.info({ cycle: this.cycleNumber, songCount: allLyrics.length }, 'Phase 4: Generating songs via Suno');

    let songsProduced = 0;

    if (this.sunoGenerator) {
      songsProduced = await this.generateSongBatch(allLyrics, errors);
    } else {
      const msg = 'Suno API not initialized — skipping song generation. Set SUNO_API_KEY in .env';
      logger.warn(msg);
      errors.push(msg);
    }

    // ── Done ────────────────────────────────────────────────────────────────
    this.currentPhase = 'idle';

    return {
      articlesScraped: articles.length,
      storiesSynthesized: stories.length,
      lyricsGenerated: allLyrics.length,
      songsProduced,
      podcastsProduced,
      errors,
    };
  }

  // ---------------------------------------------------------------------------
  // Song generation (batch, 2 concurrent)
  // ---------------------------------------------------------------------------

  private async generateSongBatch(
    lyrics: GeneratedLyrics[],
    errors: string[],
  ): Promise<number> {
    if (!this.sunoGenerator) return 0;

    let produced = 0;

    // Each API call produces 2 songs. Process lyrics one at a time (each gets 2 variants).
    // With SUNO_CONCURRENCY=2, we send 2 API calls in parallel = 4 songs.
    for (let i = 0; i < lyrics.length; i += SUNO_CONCURRENCY) {
      if (!this.running) break;

      const batch = lyrics.slice(i, i + SUNO_CONCURRENCY);
      const batchNum = Math.floor(i / SUNO_CONCURRENCY) + 1;
      const totalBatches = Math.ceil(lyrics.length / SUNO_CONCURRENCY);

      logger.info(
        { batch: batchNum, total: totalBatches, titles: batch.map((l) => l.title) },
        'Generating song batch via API',
      );

      const results = await Promise.allSettled(
        batch.map((l) => this.generateSongViaApi(l)),
      );

      for (const result of results) {
        if (result.status === 'fulfilled') {
          produced += result.value;
        } else {
          const msg = `Song generation failed: ${String(result.reason)}`;
          logger.error(msg);
          errors.push(msg);
        }
      }
    }

    return produced;
  }

  /**
   * Generate song(s) via Suno API. Each call returns 2 song variants.
   * We download the first (best) one and add it to the buffer.
   */
  private async generateSongViaApi(lyrics: GeneratedLyrics): Promise<number> {
    if (!this.sunoGenerator) throw new Error('Suno API not initialized');

    this.pendingGeneration++;
    const config = getConfig();
    const outputDir = getDateDir(path.join(config.MEDIA_DIR, 'songs'));

    try {
      const results = await this.sunoGenerator.generate({
        style: lyrics.genre.sunoStyle,
        lyrics: lyrics.lyrics,
        title: lyrics.title,
      });

      // Use the first result (best variant)
      let saved = 0;
      for (const result of results.slice(0, 1)) {
        const id = nanoid();
        const outputPath = path.join(outputDir, `${id}.mp3`);

        await downloadAudio(result.audioUrl, outputPath);

        const entry: AudioBufferEntry = {
          id,
          type: 'song',
          title: lyrics.title,
          filePath: outputPath,
          durationSeconds: Math.round(result.duration),
          metadata: {
            genre: lyrics.genre.name,
            clipId: result.clipId,
            storyHeadline: lyrics.storyHeadline,
            storyAngle: lyrics.storyAngle,
            sunoStyle: lyrics.genre.sunoStyle,
            sourceArticleIds: lyrics.sourceArticleIds,
            apiDuration: result.duration,
          },
          createdAt: new Date(),
        };

        this.audioBuffer.push(entry);
        this.persistTrack(entry);
        this.totalSongsGenerated++;
        saved++;

        logger.info(
          { title: lyrics.title, genre: lyrics.genre.name, clipId: result.clipId, bufferSize: this.audioBuffer.length },
          'Song added to buffer (via API)',
        );
      }

      return saved;
    } finally {
      this.pendingGeneration--;
    }
  }

  // ---------------------------------------------------------------------------
  // News block (TTS)
  // ---------------------------------------------------------------------------

  private async generateNewsBlock(): Promise<void> {
    const id = nanoid();
    const config = getConfig();
    const outputDir = getDateDir(path.join(config.MEDIA_DIR, 'news'));
    const outputPath = path.join(outputDir, `${id}.mp3`);

    try {
      const articles = await this.rssService.fetchOnce();
      if (articles.length === 0) {
        logger.debug('No new articles for news block — skipping');
        return;
      }

      const headlines = articles
        .slice(0, 5)
        .map((a, i) => `${i + 1}. ${a.title}. From ${a.source}.`)
        .join(' ');

      const newsText =
        `RadioWar News Update. ${new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}. ` +
        `Here are today's headlines. ${headlines} That's the latest from RadioWar.`;

      await this.ttsService.generateSpeech(newsText, outputPath);

      const entry: AudioBufferEntry = {
        id,
        type: 'news_block',
        title: `News Block ${new Date().toISOString()}`,
        filePath: outputPath,
        metadata: {
          articleCount: articles.length,
          headlines: articles.slice(0, 5).map((a) => a.title),
        },
        createdAt: new Date(),
      };

      // Insert after first 3 songs so it breaks up the music
      const insertPosition = Math.min(3, this.audioBuffer.length);
      this.audioBuffer.splice(insertPosition, 0, entry);
      this.persistTrack(entry);
      this.totalNewsBlocksGenerated++;

      logger.info(
        { articleCount: articles.length, bufferSize: this.audioBuffer.length },
        'News block added to buffer',
      );
    } catch (err) {
      logger.error({ err }, 'News block generation failed');
    }
  }

  // ---------------------------------------------------------------------------
  // Stream control (public — used by API routes)
  // ---------------------------------------------------------------------------

  async startStream(): Promise<void> {
    if (this.streamManager) {
      logger.warn('Stream already running');
      return;
    }

    const config = getConfig();
    if (!config.YOUTUBE_STREAM_KEY) {
      throw new Error('YOUTUBE_STREAM_KEY not configured. Set it in .env file.');
    }

    this.streamManager = new StreamManager({
      rtmpUrl: config.YOUTUBE_RTMP_URL,
      streamKey: config.YOUTUBE_STREAM_KEY,
      backgroundImage: existsSync(path.join(config.MEDIA_DIR, 'background.png'))
        ? path.join(config.MEDIA_DIR, 'background.png')
        : path.resolve('assets/background.png'),
    });

    void this.streamManager.startStreaming(() => this.dequeueAudio());
    logger.info('Stream started via API');
  }

  stopStream(): void {
    if (this.streamManager) {
      this.streamManager.stop();
      this.streamManager = null;
      logger.info('Stream stopped via API');
    }
  }

  getStreamStatus(): StreamStatus | null {
    return this.streamManager?.getStatus() ?? null;
  }

  // ---------------------------------------------------------------------------
  // Stream initialization (auto-start if configured)
  // ---------------------------------------------------------------------------

  private async initStream(): Promise<void> {
    const config = getConfig();
    if (!config.YOUTUBE_STREAM_KEY) {
      logger.info('YOUTUBE_STREAM_KEY not set — stream disabled. Set it in .env to enable.');
      return;
    }

    try {
      await this.startStream();
    } catch (err) {
      logger.error({ err }, 'Failed to auto-start stream');
    }
  }

  // ---------------------------------------------------------------------------
  // Suno API initialization
  // ---------------------------------------------------------------------------

  private initSunoApi(): void {
    const config = getConfig();

    if (!config.SUNO_API_KEY) {
      logger.warn('SUNO_API_KEY not set — song generation disabled. Get a key at https://sunoapi.org/api-key');
      return;
    }

    try {
      this.sunoGenerator = new SunoApiGenerator();

      // Check credits asynchronously
      this.sunoGenerator.getCredits().then((credits) => {
        logger.info({ credits }, 'Suno API initialized — remaining credits');
      }).catch((err) => {
        logger.warn({ err: String(err) }, 'Could not check Suno API credits');
      });

      logger.info({ model: config.SUNO_API_MODEL }, 'Suno API generator initialized');
    } catch (err) {
      logger.error({ err }, 'Suno API initialization failed — song generation disabled');
      this.sunoGenerator = null;
    }
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let _pipeline: Pipeline | null = null;

export function getPipeline(): Pipeline {
  if (!_pipeline) {
    _pipeline = new Pipeline();
  }
  return _pipeline;
}
