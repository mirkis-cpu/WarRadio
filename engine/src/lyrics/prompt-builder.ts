import type { GenreDefinition } from './genres.js';
import type { NewsArticle } from '../services/rss-service.js';

export interface LyricsPromptResult {
  systemPrompt: string;
  userPrompt: string;
}

export interface LyricsOutput {
  title: string;
  lyrics: string;
}

const SECTION_MARKERS = {
  verse: '[Verse]',
  chorus: '[Chorus]',
  bridge: '[Bridge]',
  outro: '[Outro]',
};

function buildStructureDescription(genre: GenreDefinition): string {
  const sections: string[] = [];

  for (let i = 0; i < genre.verseCount; i++) {
    sections.push(`${SECTION_MARKERS.verse} ${i + 1}`);
    if (genre.hasChorus && i < genre.verseCount - 1) {
      sections.push(`${SECTION_MARKERS.chorus}`);
    }
  }

  if (genre.hasChorus) {
    sections.push(`${SECTION_MARKERS.chorus} (final)`);
  }

  if (genre.hasBridge) {
    sections.push(`${SECTION_MARKERS.bridge}`);
    if (genre.hasChorus) {
      sections.push(`${SECTION_MARKERS.chorus} (outro)`);
    }
  }

  sections.push(`${SECTION_MARKERS.outro}`);

  return sections.join(' → ');
}

export function buildLyricsPrompt(
  article: NewsArticle,
  genre: GenreDefinition,
  language: string = 'en',
): LyricsPromptResult {
  const structure = buildStructureDescription(genre);

  const systemPrompt = `You are a ${genre.claudePersonality}.

Your task: transform a real war/conflict news article into powerful, authentic ${genre.name} song lyrics.

STRICT RULES:
1. Output ONLY valid JSON: {"title": "...", "lyrics": "..."}
2. Title: maximum 6 words, punchy and specific — no clichés like "War Torn" or "Broken Dreams"
3. Lyrics: 350–450 words total
4. Use these exact section markers in the lyrics string: [Verse], [Chorus], [Bridge], [Outro]
5. Structure: ${structure}
6. Language: ${language}
7. Style: ${genre.sunoStyle}
8. NO CLICHÉS: avoid "tears fall", "hearts break", "darkness descends", "hope shines"
9. Use vivid, specific, concrete imagery drawn directly from the article
10. Name real places, real actions, real consequences — make it feel reportage
11. Each line should earn its place — no filler, no padding
12. The emotional truth must come from specifics, not from generic sentiment`;

  const userPrompt = `Transform this news article into ${genre.name} lyrics:

HEADLINE: ${article.title}
SOURCE: ${article.source}
PUBLISHED: ${article.publishedAt.toISOString()}

ARTICLE SUMMARY:
${article.description}

ARTICLE LINK: ${article.link}

Remember:
- JSON only: {"title": "...", "lyrics": "..."}
- Max 6 word title
- 350-450 words in the lyrics
- Use [Verse], [Chorus], [Bridge], [Outro] markers
- Vivid, specific imagery from THIS article — not generic war imagery`;

  return { systemPrompt, userPrompt };
}

export function parseLyricsResponse(raw: string): LyricsOutput {
  // Strip markdown code fences if present
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/, '')
    .trim();

  const parsed = JSON.parse(cleaned) as unknown;

  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    typeof (parsed as Record<string, unknown>).title !== 'string' ||
    typeof (parsed as Record<string, unknown>).lyrics !== 'string'
  ) {
    throw new Error('Claude response did not match expected {title, lyrics} shape');
  }

  const output = parsed as LyricsOutput;

  // Validate title word count
  const wordCount = output.title.trim().split(/\s+/).length;
  if (wordCount > 6) {
    // Truncate to 6 words rather than throwing
    output.title = output.title.trim().split(/\s+/).slice(0, 6).join(' ');
  }

  return output;
}
