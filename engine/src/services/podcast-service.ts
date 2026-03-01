import path from 'path';
import { promises as fs } from 'fs';
import { nanoid } from 'nanoid';
import { getConfig } from '../config.js';
import { logger } from '../utils/logger.js';
import { withRetry } from '../utils/retry.js';
import { callClaudeCli } from '../utils/claude-cli.js';
import { TtsService } from './tts-service.js';
import {
  buildPodcastScriptPrompt,
  parsePodcastScriptResponse,
  type PodcastScript,
  type SynthesizedStory,
} from '../podcast/prompt-builder.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PodcastEpisode {
  id: string;
  title: string;
  scriptText: string;
  audioPath: string;
  durationEstimateMinutes: number;
  storyCount: number;
  generatedAt: Date;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class PodcastService {
  private readonly ttsService: TtsService;

  constructor(ttsService?: TtsService) {
    this.ttsService = ttsService ?? new TtsService();
  }

  /**
   * Generate a full podcast episode from synthesized stories.
   * 1. Call Claude CLI to generate podcast script
   * 2. Call TtsService to generate audio from the full script text
   * 3. Return episode metadata
   */
  async generateEpisode(stories: SynthesizedStory[]): Promise<PodcastEpisode> {
    if (stories.length === 0) {
      throw new Error('No stories provided for podcast generation');
    }

    const config = getConfig();
    const id = nanoid();
    const podcastDir = path.join(config.MEDIA_DIR, 'podcasts');
    const outputPath = path.join(podcastDir, `${id}.mp3`);

    // Ensure output directory exists
    await fs.mkdir(podcastDir, { recursive: true });

    const voice = config.PODCAST_VOICE;
    const targetMinutes = config.PODCAST_TARGET_MINUTES;

    logger.info(
      { id, storyCount: stories.length, targetMinutes, voice },
      'Generating podcast episode',
    );

    // ── Step 1: Generate podcast script via Claude CLI ──────────────────────
    logger.info({ id }, 'Step 1: Generating podcast script via Claude');

    const script = await withRetry(
      async () => {
        const { systemPrompt, userPrompt } = buildPodcastScriptPrompt(stories, targetMinutes);
        const response = await callClaudeCli(userPrompt, {
          systemPrompt,
          timeout: 240_000, // 4 minutes — longer scripts need more time
        });
        return parsePodcastScriptResponse(response);
      },
      { maxAttempts: 3, baseDelay: 3000, maxDelay: 15000, label: 'podcast-script' },
    );

    logger.info(
      {
        id,
        title: script.title,
        segments: script.segments.length,
        estimatedMinutes: script.estimatedDurationMinutes,
        wordCount: script.fullText.split(/\s+/).length,
      },
      'Podcast script generated',
    );

    // ── Step 2: Generate audio via TTS ──────────────────────────────────────
    logger.info({ id, textLength: script.fullText.length }, 'Step 2: Generating audio via TTS');

    await this.ttsService.generateSpeech(script.fullText, outputPath, voice);

    logger.info({ id, outputPath }, 'Podcast audio generated');

    // ── Done ────────────────────────────────────────────────────────────────
    const episode: PodcastEpisode = {
      id,
      title: script.title,
      scriptText: script.fullText,
      audioPath: outputPath,
      durationEstimateMinutes: script.estimatedDurationMinutes,
      storyCount: stories.length,
      generatedAt: new Date(),
    };

    logger.info(
      { id, title: episode.title, durationEstimate: episode.durationEstimateMinutes },
      'Podcast episode complete',
    );

    return episode;
  }
}
