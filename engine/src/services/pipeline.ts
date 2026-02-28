import path from 'path';
import { nanoid } from 'nanoid';
import { getConfig } from '../config.js';
import { logger } from '../utils/logger.js';
import { sleep } from '../utils/sleep.js';
import { RssService, type NewsArticle } from './rss-service.js';
import { LyricsService, type GeneratedLyrics, type SynthesizedStory } from './lyrics-service.js';
import { TtsService } from './tts-service.js';
import { SunoSession } from '../suno/session.js';
import { SunoGenerator } from '../suno/generator.js';
import { downloadAudio } from '../suno/downloader.js';
import { StreamManager, type StreamStatus } from './stream-manager.js';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** How many songs to generate per cycle (10 songs × ~3min = ~30min of content) */
const SONGS_PER_CYCLE = 10;

/** Interval between production cycles (6x/day = every 4 hours) */
const CYCLE_INTERVAL_MS = 4 * 60 * 60 * 1000;

/** Max concurrent Suno generation requests */
const SUNO_CONCURRENCY = 2;

/** News block (TTS) interval */
const NEWS_BLOCK_INTERVAL_MS = 15 * 60 * 1000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AudioBufferEntry {
  id: string;
  type: 'song' | 'news_block';
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
  currentPhase: string;
  stream: StreamStatus | null;
}

export interface CycleResult {
  articlesScraped: number;
  storiesSynthesized: number;
  lyricsGenerated: number;
  songsProduced: number;
  errors: string[];
}

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------

export class Pipeline {
  private readonly rssService: RssService;
  private readonly lyricsService: LyricsService;
  private readonly ttsService: TtsService;
  private sunoSession: SunoSession | null = null;
  private sunoGenerator: SunoGenerator | null = null;
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
  private currentPhase = 'idle';
  private cycleTimer: NodeJS.Timeout | null = null;
  private newsBlockTimer: NodeJS.Timeout | null = null;

  constructor() {
    this.rssService = new RssService();
    this.lyricsService = new LyricsService();
    this.ttsService = new TtsService();
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

    // Initialize Suno browser session
    await this.initSuno();

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

    if (this.sunoSession) {
      await this.sunoSession.destroy();
      this.sunoSession = null;
      this.sunoGenerator = null;
    }

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
      // Archive songs for replay (not news blocks — those are time-sensitive)
      if (track.type === 'song') {
        this.playedArchive.push(track);
      }
      return track;
    }

    // 2. Loop through archive when no new tracks
    if (this.playedArchive.length === 0) {
      return null;
    }

    const track = this.playedArchive[this.archivePosition % this.playedArchive.length];
    this.archivePosition++;
    return track;
  }

  peekBuffer(): AudioBufferEntry[] {
    return [...this.audioBuffer];
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

    // ── Phase 1: RSS Fetch ──────────────────────────────────────────────────
    this.currentPhase = 'scraping';
    logger.info({ cycle: this.cycleNumber }, 'Phase 1: Fetching RSS feeds');

    let articles: NewsArticle[] = [];
    try {
      articles = await this.rssService.fetchOnce();
    } catch (err) {
      const msg = `RSS fetch failed: ${String(err)}`;
      logger.error({ err }, msg);
      errors.push(msg);
    }

    logger.info({ articleCount: articles.length }, 'RSS fetch complete');

    if (articles.length === 0) {
      this.currentPhase = 'idle';
      return { articlesScraped: 0, storiesSynthesized: 0, lyricsGenerated: 0, songsProduced: 0, errors };
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
      return { articlesScraped: articles.length, storiesSynthesized: 0, lyricsGenerated: 0, songsProduced: 0, errors };
    }

    logger.info(
      { storyCount: stories.length, headlines: stories.map((s) => s.headline) },
      'News synthesis complete',
    );

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
      const msg = 'Suno not initialized — skipping song generation. Run: npm run suno:login';
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
    let produced = 0;

    for (let i = 0; i < lyrics.length; i += SUNO_CONCURRENCY) {
      if (!this.running) break;

      const batch = lyrics.slice(i, i + SUNO_CONCURRENCY);
      const batchNum = Math.floor(i / SUNO_CONCURRENCY) + 1;
      const totalBatches = Math.ceil(lyrics.length / SUNO_CONCURRENCY);

      logger.info(
        { batch: batchNum, total: totalBatches, titles: batch.map((l) => l.title) },
        'Generating song batch',
      );

      const results = await Promise.allSettled(
        batch.map((l) => this.generateSingleSong(l)),
      );

      for (const result of results) {
        if (result.status === 'fulfilled') {
          produced++;
        } else {
          const msg = `Song generation failed: ${String(result.reason)}`;
          logger.error(msg);
          errors.push(msg);
        }
      }
    }

    return produced;
  }

  private async generateSingleSong(lyrics: GeneratedLyrics): Promise<void> {
    if (!this.sunoGenerator) throw new Error('Suno not initialized');

    this.pendingGeneration++;
    const id = nanoid();
    const config = getConfig();
    const outputPath = path.join(config.MEDIA_DIR, 'songs', `${id}.mp3`);

    try {
      const result = await this.sunoGenerator.generate({
        style: lyrics.genre.sunoStyle,
        lyrics: lyrics.lyrics,
        title: lyrics.title,
      });

      await downloadAudio(result.audioUrl, outputPath);

      const entry: AudioBufferEntry = {
        id,
        type: 'song',
        title: lyrics.title,
        filePath: outputPath,
        metadata: {
          genre: lyrics.genre.name,
          clipId: result.clipId,
          storyHeadline: lyrics.storyHeadline,
          storyAngle: lyrics.storyAngle,
          sunoStyle: lyrics.genre.sunoStyle,
        },
        createdAt: new Date(),
      };

      this.audioBuffer.push(entry);
      this.totalSongsGenerated++;

      logger.info(
        { title: lyrics.title, genre: lyrics.genre.name, bufferSize: this.audioBuffer.length },
        'Song added to buffer',
      );
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
    const outputPath = path.join(config.MEDIA_DIR, 'news', `${id}.mp3`);

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
      backgroundImage: path.join(config.MEDIA_DIR, 'background.png'),
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
  // Suno initialization
  // ---------------------------------------------------------------------------

  private async initSuno(): Promise<void> {
    const config = getConfig();

    try {
      this.sunoSession = new SunoSession();
      await this.sunoSession.initialize(config.SUNO_HEADLESS);

      const isAuthed = await this.sunoSession.verifySession();
      if (!isAuthed) {
        logger.warn(
          'Suno session not authenticated — songs will not be generated. Run: npm run suno:login',
        );
      } else {
        logger.info('Suno session verified');
      }

      this.sunoGenerator = new SunoGenerator(this.sunoSession);
    } catch (err) {
      logger.error({ err }, 'Suno initialization failed — song generation disabled');
      this.sunoSession = null;
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
