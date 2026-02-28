import Anthropic from '@anthropic-ai/sdk';
import { getConfig } from '../config.js';
import { logger } from '../utils/logger.js';
import { withRetry } from '../utils/retry.js';
import {
  buildLyricsPromptFromStory,
  buildSynthesisPrompt,
  parseLyricsResponse,
  parseSynthesisResponse,
  type LyricsOutput,
  type SynthesizedStory,
} from '../lyrics/prompt-builder.js';
import { GenreRotator } from '../lyrics/genre-rotator.js';
import type { NewsArticle } from './rss-service.js';
import type { GenreDefinition } from '../lyrics/genres.js';

export type { SynthesizedStory } from '../lyrics/prompt-builder.js';

export interface GeneratedLyrics {
  title: string;
  lyrics: string;
  genre: GenreDefinition;
  storyHeadline: string;
  storyAngle: string;
  generatedAt: Date;
}

const SYNTHESIS_MODEL = 'claude-sonnet-4-5';
const LYRICS_MODEL = 'claude-sonnet-4-5';
const SYNTHESIS_MAX_TOKENS = 4000;
const LYRICS_MAX_TOKENS = 1500;

export class LyricsService {
  private readonly client: Anthropic;
  private readonly rotator: GenreRotator;

  constructor() {
    const config = getConfig();
    this.client = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });
    this.rotator = new GenreRotator();
  }

  /**
   * Synthesize a batch of raw articles into unique story angles.
   * Claude clusters duplicates, merges facts, applies editorial stance.
   */
  async synthesizeNews(
    articles: NewsArticle[],
    targetCount: number = 10,
  ): Promise<SynthesizedStory[]> {
    if (articles.length === 0) {
      logger.warn('No articles to synthesize');
      return [];
    }

    logger.info(
      { articleCount: articles.length, targetCount },
      'Synthesizing news articles into stories',
    );

    // Build article summaries for Claude
    const summaries = articles
      .map((a) =>
        `[ID: ${a.id}] [Source: ${a.source}] ${a.title}\n${a.description}`,
      )
      .join('\n\n---\n\n');

    const { systemPrompt, userPrompt } = buildSynthesisPrompt(summaries, targetCount);

    const stories = await withRetry(
      () => this.callClaudeSynthesis(systemPrompt, userPrompt),
      { maxAttempts: 3, baseDelay: 3000, maxDelay: 15000, label: 'news-synthesis' },
    );

    logger.info(
      { storyCount: stories.length, topHeadline: stories[0]?.headline },
      'News synthesis complete',
    );

    return stories;
  }

  /**
   * Generate lyrics for a batch of synthesized stories.
   * Runs up to 3 in parallel for speed, rotates genres.
   */
  async batchGenerateLyrics(stories: SynthesizedStory[]): Promise<GeneratedLyrics[]> {
    logger.info({ storyCount: stories.length }, 'Batch generating lyrics');

    this.rotator.reset();
    const results: GeneratedLyrics[] = [];

    // Process 3 at a time to stay within Claude rate limits
    for (let i = 0; i < stories.length; i += 3) {
      const batch = stories.slice(i, i + 3);
      const batchResults = await Promise.allSettled(
        batch.map((story) => this.generateLyricsFromStory(story)),
      );

      for (const result of batchResults) {
        if (result.status === 'fulfilled') {
          results.push(result.value);
        } else {
          logger.error({ err: result.reason }, 'Failed to generate lyrics for story');
        }
      }
    }

    logger.info(
      { generated: results.length, requested: stories.length },
      'Batch lyrics generation complete',
    );

    return results;
  }

  /**
   * Generate lyrics for a single synthesized story.
   */
  async generateLyricsFromStory(
    story: SynthesizedStory,
    genre?: GenreDefinition,
  ): Promise<GeneratedLyrics> {
    const selectedGenre = genre ?? this.rotator.next();

    logger.info(
      { headline: story.headline, genre: selectedGenre.name },
      'Generating lyrics from story',
    );

    const { systemPrompt, userPrompt } = buildLyricsPromptFromStory(story, selectedGenre);

    const output = await withRetry(
      () => this.callClaudeLyrics(systemPrompt, userPrompt),
      { maxAttempts: 3, baseDelay: 2000, maxDelay: 15000, label: 'lyrics-generation' },
    );

    logger.info(
      { headline: story.headline, genre: selectedGenre.name, title: output.title },
      'Lyrics generated',
    );

    return {
      title: output.title,
      lyrics: output.lyrics,
      genre: selectedGenre,
      storyHeadline: story.headline,
      storyAngle: story.angle,
      generatedAt: new Date(),
    };
  }

  // ---------------------------------------------------------------------------
  // Private: Claude API calls
  // ---------------------------------------------------------------------------

  private async callClaudeSynthesis(
    systemPrompt: string,
    userPrompt: string,
  ): Promise<SynthesizedStory[]> {
    const message = await this.client.messages.create({
      model: SYNTHESIS_MODEL,
      max_tokens: SYNTHESIS_MAX_TOKENS,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const textBlock = message.content.find((block) => block.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      throw new Error('Claude returned no text content for synthesis');
    }

    return parseSynthesisResponse(textBlock.text);
  }

  private async callClaudeLyrics(
    systemPrompt: string,
    userPrompt: string,
  ): Promise<LyricsOutput> {
    const message = await this.client.messages.create({
      model: LYRICS_MODEL,
      max_tokens: LYRICS_MAX_TOKENS,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const textBlock = message.content.find((block) => block.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      throw new Error('Claude returned no text content for lyrics');
    }

    return parseLyricsResponse(textBlock.text);
  }
}
