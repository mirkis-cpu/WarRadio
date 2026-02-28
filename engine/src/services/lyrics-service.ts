import Anthropic from '@anthropic-ai/sdk';
import { getConfig } from '../config.js';
import { logger } from '../utils/logger.js';
import { withRetry } from '../utils/retry.js';
import { buildLyricsPrompt, parseLyricsResponse, type LyricsOutput } from '../lyrics/prompt-builder.js';
import { GenreRotator } from '../lyrics/genre-rotator.js';
import type { NewsArticle } from './rss-service.js';
import type { GenreDefinition } from '../lyrics/genres.js';

export interface GeneratedLyrics {
  title: string;
  lyrics: string;
  genre: GenreDefinition;
  article: NewsArticle;
  generatedAt: Date;
}

const MODEL = 'claude-sonnet-4-5';
const MAX_TOKENS = 1500;

export class LyricsService {
  private readonly client: Anthropic;
  private readonly rotator: GenreRotator;

  constructor() {
    const config = getConfig();
    this.client = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });
    this.rotator = new GenreRotator();
  }

  /**
   * Generate song lyrics for a given news article.
   * Picks the next genre via the weighted rotator.
   */
  async generateLyrics(
    article: NewsArticle,
    language = 'en',
    genre?: GenreDefinition,
  ): Promise<GeneratedLyrics> {
    const selectedGenre = genre ?? this.rotator.next();

    logger.info(
      { articleId: article.id, genre: selectedGenre.name, source: article.source },
      'Generating lyrics',
    );

    const { systemPrompt, userPrompt } = buildLyricsPrompt(article, selectedGenre, language);

    const output = await withRetry(
      () => this.callClaude(systemPrompt, userPrompt),
      { maxAttempts: 3, baseDelay: 2000, maxDelay: 15000, label: 'lyrics-generation' },
    );

    logger.info(
      { articleId: article.id, genre: selectedGenre.name, title: output.title },
      'Lyrics generated',
    );

    return {
      title: output.title,
      lyrics: output.lyrics,
      genre: selectedGenre,
      article,
      generatedAt: new Date(),
    };
  }

  private async callClaude(systemPrompt: string, userPrompt: string): Promise<LyricsOutput> {
    const message = await this.client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: systemPrompt,
      messages: [
        { role: 'user', content: userPrompt },
      ],
    });

    const textBlock = message.content.find(block => block.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      throw new Error('Claude returned no text content');
    }

    return parseLyricsResponse(textBlock.text);
  }
}
