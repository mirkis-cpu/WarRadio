import { logger } from '../utils/logger.js';
import { withRetry } from '../utils/retry.js';
import { callClaudeCli } from '../utils/claude-cli.js';
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

export class LyricsService {
  private readonly rotator: GenreRotator;

  constructor() {
    this.rotator = new GenreRotator();
  }

  /**
   * Synthesize a batch of raw articles into unique story angles.
   * Uses `claude` CLI (Max subscription auth).
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

    const summaries = articles
      .map((a) =>
        `[ID: ${a.id}] [Source: ${a.source}] ${a.title}\n${a.description}`,
      )
      .join('\n\n---\n\n');

    const { systemPrompt, userPrompt } = buildSynthesisPrompt(summaries, targetCount);

    const stories = await withRetry(
      async () => {
        const response = await callClaudeCli(userPrompt, {
          systemPrompt,
          timeout: 180_000,
        });
        return parseSynthesisResponse(response);
      },
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
   * Runs sequentially (each call spawns a claude process).
   */
  async batchGenerateLyrics(stories: SynthesizedStory[]): Promise<GeneratedLyrics[]> {
    logger.info({ storyCount: stories.length }, 'Batch generating lyrics');

    this.rotator.reset();
    const results: GeneratedLyrics[] = [];

    for (const [i, story] of stories.entries()) {
      try {
        logger.info(
          { index: i + 1, total: stories.length, headline: story.headline },
          'Generating lyrics',
        );
        const lyrics = await this.generateLyricsFromStory(story);
        results.push(lyrics);
      } catch (err) {
        logger.error({ err, headline: story.headline }, 'Failed to generate lyrics');
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
      async () => {
        const response = await callClaudeCli(userPrompt, {
          systemPrompt,
          timeout: 120_000,
        });
        return parseLyricsResponse(response);
      },
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
}
