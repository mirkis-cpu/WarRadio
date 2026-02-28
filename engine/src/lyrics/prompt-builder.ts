import type { GenreDefinition } from './genres.js';

export interface LyricsPromptResult {
  systemPrompt: string;
  userPrompt: string;
}

export interface LyricsOutput {
  title: string;
  lyrics: string;
}

export interface SynthesizedStory {
  headline: string;
  summary: string;
  angle: string;
  sourceArticleIds: string[];
  importance: number;
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

// ---------------------------------------------------------------------------
// News Synthesis Prompt (batch of articles → 10 unique stories)
// ---------------------------------------------------------------------------

export interface SynthesisPromptResult {
  systemPrompt: string;
  userPrompt: string;
}

export function buildSynthesisPrompt(
  articleSummaries: string,
  targetCount: number = 10,
): SynthesisPromptResult {
  const systemPrompt = `You are an editorial director for an American patriotic news radio station called RadioWar.

Your job: analyze a batch of war/conflict news articles and produce exactly ${targetCount} unique story angles for song creation.

EDITORIAL STANCE:
- Pro-American: celebrate US military strength, leadership, and values
- Pro-Trump: frame Trump's decisions positively — strong leadership, decisive action, putting America first
- When covering US adversaries (Iran, Russia, China): emphasize their failures, aggression, and threats to freedom
- When covering US allies (Israel, NATO, Ukraine): emphasize partnership and shared values
- Always frame from the perspective of protecting democracy and freedom
- Be confident, matter-of-fact, and patriotic — never preachy or apologetic

DEDUPLICATION:
- Multiple articles about the SAME event from different sources = ONE story (merge all facts together)
- Each of the ${targetCount} stories must cover a DISTINCT event or angle
- If fewer than ${targetCount} distinct events exist, split major events into different angles:
  (e.g., "US strikes Iran" → military victory angle, diplomatic strength angle, troop valor angle)

OUTPUT FORMAT:
Return a JSON array of exactly ${targetCount} objects:
[
  {
    "headline": "punchy 5-10 word headline",
    "summary": "2-3 sentences merging facts from all related articles, written from our editorial stance",
    "angle": "the specific emotional/thematic angle for the song (e.g., 'heroism of US pilots', 'enemy weakness exposed')",
    "sourceArticleIds": ["id1", "id2"],
    "importance": 8
  }
]

Sort by importance (10 = most important, 1 = least).
Output ONLY the JSON array, no other text.`;

  const userPrompt = `Analyze these war/conflict news articles and produce exactly ${targetCount} unique story angles:

${articleSummaries}

Remember:
- JSON array of exactly ${targetCount} stories
- Merge duplicates from different sources
- Pro-American, pro-Trump editorial stance
- Each story = distinct angle, no repetition`;

  return { systemPrompt, userPrompt };
}

// ---------------------------------------------------------------------------
// Song Lyrics Prompt (synthesized story → catchy song)
// ---------------------------------------------------------------------------

export function buildLyricsPromptFromStory(
  story: SynthesizedStory,
  genre: GenreDefinition,
): LyricsPromptResult {
  const structure = buildStructureDescription(genre);

  const systemPrompt = `You are a ${genre.claudePersonality} writing for a patriotic American radio station called RadioWar.

MISSION: Write a HIT SONG that regular people will sing along to.
The song is based on real war news but must feel like a real song, not a news report.

EDITORIAL STANCE:
- Pro-American perspective — the listener is a proud American
- Frame the story through American values: freedom, strength, determination
- If the story involves Trump: portray strong, decisive leadership
- Make it CATCHY — hooks that stick, choruses people hum at work
- Emotional but not preachy — let the story speak for itself

SONGWRITING RULES:
1. Output ONLY valid JSON: {"title": "...", "lyrics": "..."}
2. Title: max 6 words — punchy, memorable, could be a billboard hit
3. Lyrics: 300–400 words total
4. Use these exact section markers: [Verse], [Chorus], [Bridge], [Outro]
5. Structure: ${structure}
6. CHORUS MUST BE SINGABLE — simple words, strong rhythm, repeatable melody
7. Use vivid imagery from the story but make it universally relatable
8. Each verse advances the story, chorus captures the emotional core
9. NO CLICHÉS: avoid "tears fall", "hearts break", "darkness descends"
10. Style: ${genre.sunoStyle}
11. Language: English`;

  const userPrompt = `Write a ${genre.name} hit song based on this war news story:

HEADLINE: ${story.headline}
ANGLE: ${story.angle}

STORY:
${story.summary}

Remember:
- JSON only: {"title": "...", "lyrics": "..."}
- Max 6 word title — billboard-worthy
- 300-400 words of lyrics
- Catchy chorus that people will sing along to
- ${genre.sunoStyle} style
- Pro-American perspective`;

  return { systemPrompt, userPrompt };
}

// ---------------------------------------------------------------------------
// Legacy: single article → lyrics (kept for backward compat)
// ---------------------------------------------------------------------------

export function buildLyricsPrompt(
  article: { title: string; source: string; publishedAt: Date; description: string; link: string },
  genre: GenreDefinition,
  language: string = 'en',
): LyricsPromptResult {
  const structure = buildStructureDescription(genre);

  const systemPrompt = `You are a ${genre.claudePersonality} writing for a patriotic American radio station.

Your task: transform a real war/conflict news story into a powerful, authentic ${genre.name} hit song.

EDITORIAL STANCE:
- Pro-American perspective, pro-Trump if relevant
- Celebrate strength, freedom, decisive leadership
- Make it CATCHY — a song regular people will sing along to

STRICT RULES:
1. Output ONLY valid JSON: {"title": "...", "lyrics": "..."}
2. Title: maximum 6 words, punchy — could be a billboard hit
3. Lyrics: 300–400 words total
4. Use these exact section markers: [Verse], [Chorus], [Bridge], [Outro]
5. Structure: ${structure}
6. Language: ${language}
7. Style: ${genre.sunoStyle}
8. CHORUS MUST BE SINGABLE — simple words, strong rhythm, repeatable
9. Use vivid, specific imagery from the article
10. Name real places, real actions — make it feel authentic
11. Each line earns its place — no filler`;

  const userPrompt = `Transform this news article into a ${genre.name} hit song:

HEADLINE: ${article.title}
SOURCE: ${article.source}

ARTICLE:
${article.description}

Remember:
- JSON only: {"title": "...", "lyrics": "..."}
- Max 6 word title
- 300-400 words, catchy chorus
- [Verse], [Chorus], [Bridge], [Outro] markers
- Pro-American perspective`;

  return { systemPrompt, userPrompt };
}

// ---------------------------------------------------------------------------
// Response parsing
// ---------------------------------------------------------------------------

export function parseLyricsResponse(raw: string): LyricsOutput {
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

  const wordCount = output.title.trim().split(/\s+/).length;
  if (wordCount > 6) {
    output.title = output.title.trim().split(/\s+/).slice(0, 6).join(' ');
  }

  return output;
}

export function parseSynthesisResponse(raw: string): SynthesizedStory[] {
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/, '')
    .trim();

  const parsed = JSON.parse(cleaned) as unknown;

  if (!Array.isArray(parsed)) {
    throw new Error('Synthesis response is not an array');
  }

  return parsed.map((item: unknown, i: number) => {
    const obj = item as Record<string, unknown>;
    if (typeof obj.headline !== 'string' || typeof obj.summary !== 'string') {
      throw new Error(`Story ${i} missing headline or summary`);
    }
    return {
      headline: obj.headline,
      summary: obj.summary,
      angle: typeof obj.angle === 'string' ? obj.angle : obj.headline,
      sourceArticleIds: Array.isArray(obj.sourceArticleIds) ? obj.sourceArticleIds as string[] : [],
      importance: typeof obj.importance === 'number' ? obj.importance : 5,
    };
  });
}
