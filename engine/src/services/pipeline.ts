import path from 'path';
import { nanoid } from 'nanoid';
import { getConfig } from '../config.js';
import { logger } from '../utils/logger.js';
import { sleep } from '../utils/sleep.js';
import { RssService, type NewsArticle } from './rss-service.js';
import { LyricsService, type GeneratedLyrics } from './lyrics-service.js';
import { TtsService } from './tts-service.js';
import { SunoSession } from '../suno/session.js';
import { SunoGenerator } from '../suno/generator.js';
import { downloadAudio } from '../suno/downloader.js';

// Pipeline configuration constants
const LYRICS_QUEUE_MAX = 10;
const AUDIO_BUFFER_MIN = 3;
const AUDIO_BUFFER_TARGET = 6;
const PIPELINE_LOOP_INTERVAL_MS = 30_000; // 30 seconds
const NEWS_BLOCK_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes

const FILLER_TOPICS: string[] = [
  'ongoing conflicts reshaping borders',
  'the human cost of modern warfare',
  'soldiers returning home changed',
  'civilians caught in the crossfire',
  'resistance in occupied territories',
  'war correspondents on the frontline',
  'the economics of arms dealing',
  'refugees rebuilding after conflict',
  'propaganda versus ground truth',
  'the silence after a ceasefire',
];

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
  lyricsQueueSize: number;
  audioBufferSize: number;
  pendingGeneration: number;
  lastRssFetch: Date | null;
  totalSongsGenerated: number;
  totalNewsBlocksGenerated: number;
}

export class Pipeline {
  private readonly rssService: RssService;
  private readonly lyricsService: LyricsService;
  private readonly ttsService: TtsService;
  private sunoSession: SunoSession | null = null;
  private sunoGenerator: SunoGenerator | null = null;

  private readonly lyricsQueue: GeneratedLyrics[] = [];
  private readonly audioBuffer: AudioBufferEntry[] = [];

  private running = false;
  private pendingGeneration = 0;
  private lastRssFetch: Date | null = null;
  private totalSongsGenerated = 0;
  private totalNewsBlocksGenerated = 0;
  private loopTimer: NodeJS.Timeout | null = null;
  private newsBlockTimer: NodeJS.Timeout | null = null;

  constructor() {
    this.rssService = new RssService();
    this.lyricsService = new LyricsService();
    this.ttsService = new TtsService();
  }

  /** Start the full pipeline: RSS polling, lyrics gen, audio gen. */
  async start(): Promise<void> {
    if (this.running) {
      logger.warn('Pipeline already running');
      return;
    }

    this.running = true;
    logger.info('Pipeline starting');

    // Initialize Suno browser session
    await this.initSuno();

    // Wire up RSS events
    this.rssService.on('articles', (articles: NewsArticle[]) => {
      void this.handleNewArticles(articles);
    });
    this.rssService.on('error', (err: Error, feedName: string) => {
      logger.error({ err, feedName }, 'RSS feed error');
    });

    this.rssService.start();

    // Schedule periodic news blocks via TTS
    this.newsBlockTimer = setInterval(() => {
      void this.generateNewsBlock();
    }, NEWS_BLOCK_INTERVAL_MS);

    // Start main production loop
    void this.productionLoop();

    logger.info('Pipeline running');
  }

  /** Stop the pipeline gracefully. */
  async stop(): Promise<void> {
    this.running = false;

    this.rssService.stop();

    if (this.loopTimer) {
      clearTimeout(this.loopTimer);
      this.loopTimer = null;
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

    logger.info('Pipeline stopped');
  }

  /** Get current pipeline status. */
  getStatus(): PipelineStatus {
    return {
      running: this.running,
      lyricsQueueSize: this.lyricsQueue.length,
      audioBufferSize: this.audioBuffer.length,
      pendingGeneration: this.pendingGeneration,
      lastRssFetch: this.lastRssFetch,
      totalSongsGenerated: this.totalSongsGenerated,
      totalNewsBlocksGenerated: this.totalNewsBlocksGenerated,
    };
  }

  /** Pop the next audio item from the buffer for playback. */
  dequeueAudio(): AudioBufferEntry | null {
    return this.audioBuffer.shift() ?? null;
  }

  /** Peek at the buffer without consuming. */
  peekBuffer(): AudioBufferEntry[] {
    return [...this.audioBuffer];
  }

  // ---------------------------------------------------------------------------
  // Private: production loop
  // ---------------------------------------------------------------------------

  private async productionLoop(): Promise<void> {
    while (this.running) {
      try {
        await this.tick();
      } catch (err) {
        logger.error({ err }, 'Pipeline production loop error');
      }

      await sleep(PIPELINE_LOOP_INTERVAL_MS);
    }
  }

  private async tick(): Promise<void> {
    const bufferSize = this.audioBuffer.length;
    const queueSize = this.lyricsQueue.length;

    logger.debug(
      { bufferSize, queueSize, pendingGeneration: this.pendingGeneration },
      'Pipeline tick',
    );

    // If buffer is not satisfied and we have lyrics, generate audio
    if (bufferSize < AUDIO_BUFFER_TARGET && queueSize > 0 && this.pendingGeneration < 2) {
      const lyrics = this.lyricsQueue.shift()!;
      void this.generateSongFromLyrics(lyrics);
      return;
    }

    // If buffer is critical and no pending lyrics and no pending generation, use filler
    if (bufferSize < AUDIO_BUFFER_MIN && queueSize === 0 && this.pendingGeneration === 0) {
      logger.warn(
        { bufferSize, minBuffer: AUDIO_BUFFER_MIN },
        'Buffer critical — generating filler song',
      );
      void this.generateFillerSong();
      return;
    }

    // Proactively fetch more lyrics if queue is low
    if (queueSize < 3) {
      void this.fetchMoreLyrics();
    }
  }

  // ---------------------------------------------------------------------------
  // Private: article handling
  // ---------------------------------------------------------------------------

  private async handleNewArticles(articles: NewsArticle[]): Promise<void> {
    this.lastRssFetch = new Date();
    logger.info({ count: articles.length }, 'New articles received from RSS');

    for (const article of articles) {
      if (this.lyricsQueue.length >= LYRICS_QUEUE_MAX) {
        logger.debug('Lyrics queue full, skipping article');
        break;
      }

      try {
        const lyrics = await this.lyricsService.generateLyrics(article);
        this.enqueueLyrics(lyrics);
      } catch (err) {
        logger.error({ err, articleId: article.id }, 'Failed to generate lyrics for article');
      }
    }
  }

  private enqueueLyrics(lyrics: GeneratedLyrics): void {
    if (this.lyricsQueue.length >= LYRICS_QUEUE_MAX) {
      logger.warn('Lyrics queue at max capacity — dropping oldest entry');
      this.lyricsQueue.shift();
    }
    this.lyricsQueue.push(lyrics);
    logger.info(
      { title: lyrics.title, genre: lyrics.genre.name, queueSize: this.lyricsQueue.length },
      'Lyrics enqueued',
    );
  }

  private async fetchMoreLyrics(): Promise<void> {
    try {
      const articles = await this.rssService.fetchOnce();
      if (articles.length > 0) {
        await this.handleNewArticles(articles);
      }
    } catch (err) {
      logger.error({ err }, 'Failed to fetch more articles for lyrics');
    }
  }

  // ---------------------------------------------------------------------------
  // Private: audio generation
  // ---------------------------------------------------------------------------

  private async generateSongFromLyrics(lyrics: GeneratedLyrics): Promise<void> {
    if (!this.sunoGenerator) {
      logger.error('Suno generator not initialized — cannot generate song');
      return;
    }

    this.pendingGeneration++;
    const id = nanoid();
    const config = getConfig();
    const outputPath = path.join(config.MEDIA_DIR, 'songs', `${id}.mp3`);

    try {
      logger.info({ title: lyrics.title, genre: lyrics.genre.name }, 'Generating Suno song');

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
          articleId: lyrics.article.id,
          articleSource: lyrics.article.source,
          sunoStyle: lyrics.genre.sunoStyle,
        },
        createdAt: new Date(),
      };

      this.audioBuffer.push(entry);
      this.totalSongsGenerated++;

      logger.info(
        { title: lyrics.title, outputPath, bufferSize: this.audioBuffer.length },
        'Song added to audio buffer',
      );
    } catch (err) {
      logger.error({ err, title: lyrics.title }, 'Song generation failed');
      // Re-queue the lyrics if generation failed due to transient error
      if (this.lyricsQueue.length < LYRICS_QUEUE_MAX) {
        this.lyricsQueue.unshift(lyrics);
      }
    } finally {
      this.pendingGeneration--;
    }
  }

  private async generateFillerSong(): Promise<void> {
    if (!this.sunoGenerator) return;

    this.pendingGeneration++;

    // Pick a random filler topic
    const topic = FILLER_TOPICS[Math.floor(Math.random() * FILLER_TOPICS.length)];

    const fillerArticle: NewsArticle = {
      id: nanoid(),
      source: 'RadioWar Filler',
      title: topic,
      description: `RadioWar filler content: ${topic}. Imagine the sounds of distant conflict, the weight of history, the resilience of those who live through war.`,
      link: 'https://radiowar.internal/filler',
      publishedAt: new Date(),
      fetchedAt: new Date(),
    };

    try {
      logger.info({ topic }, 'Generating filler song');
      const lyrics = await this.lyricsService.generateLyrics(fillerArticle);
      await this.generateSongFromLyrics(lyrics);
    } catch (err) {
      logger.error({ err, topic }, 'Filler song generation failed');
    } finally {
      this.pendingGeneration--;
    }
  }

  private async generateNewsBlock(): Promise<void> {
    const id = nanoid();
    const config = getConfig();
    const outputPath = path.join(config.MEDIA_DIR, 'news', `${id}.mp3`);

    try {
      // Fetch latest articles for the news block
      const articles = await this.rssService.fetchOnce();
      if (articles.length === 0) {
        logger.debug('No new articles for news block — skipping');
        return;
      }

      const headlines = articles
        .slice(0, 5)
        .map((a, i) => `${i + 1}. ${a.title}. From ${a.source}.`)
        .join(' ');

      const newsText = `RadioWar News Update. ${new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}. ` +
        `Here are today's headlines. ${headlines} That's the latest from RadioWar.`;

      await this.ttsService.generateSpeech(newsText, outputPath);

      const entry: AudioBufferEntry = {
        id,
        type: 'news_block',
        title: `News Block ${new Date().toISOString()}`,
        filePath: outputPath,
        metadata: {
          articleCount: articles.length,
          headlines: articles.slice(0, 5).map(a => a.title),
        },
        createdAt: new Date(),
      };

      // Insert news block at appropriate position in buffer
      const insertPosition = Math.min(3, this.audioBuffer.length);
      this.audioBuffer.splice(insertPosition, 0, entry);
      this.totalNewsBlocksGenerated++;

      logger.info(
        { articleCount: articles.length, outputPath, bufferSize: this.audioBuffer.length },
        'News block added to audio buffer',
      );
    } catch (err) {
      logger.error({ err }, 'News block generation failed');
    }
  }

  // ---------------------------------------------------------------------------
  // Private: Suno initialization
  // ---------------------------------------------------------------------------

  private async initSuno(): Promise<void> {
    const config = getConfig();

    try {
      this.sunoSession = new SunoSession();
      await this.sunoSession.initialize(config.SUNO_HEADLESS);

      const isAuthed = await this.sunoSession.verifySession();
      if (!isAuthed) {
        logger.warn(
          'Suno session verification failed — songs will not be generated until a valid session is provided. ' +
          'Run: npm run suno:login',
        );
      } else {
        logger.info('Suno session verified');
      }

      this.sunoGenerator = new SunoGenerator(this.sunoSession);
    } catch (err) {
      logger.error({ err }, 'Failed to initialize Suno session — song generation disabled');
      this.sunoSession = null;
      this.sunoGenerator = null;
    }
  }
}

// Singleton instance
let _pipeline: Pipeline | null = null;

export function getPipeline(): Pipeline {
  if (!_pipeline) {
    _pipeline = new Pipeline();
  }
  return _pipeline;
}
