import type { SynthesizedStory } from '../lyrics/prompt-builder.js';

export { type SynthesizedStory };

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PodcastSegment {
  headline: string;
  narration: string;
}

export interface PodcastScript {
  title: string;
  introduction: string;
  segments: PodcastSegment[];
  outro: string;
  fullText: string;
  estimatedDurationMinutes: number;
}

export interface PodcastPromptResult {
  systemPrompt: string;
  userPrompt: string;
}

// ---------------------------------------------------------------------------
// Prompt builder
// ---------------------------------------------------------------------------

/** ~150 words per minute of speech for edge-tts */
const WORDS_PER_MINUTE = 150;

export function buildPodcastScriptPrompt(
  stories: SynthesizedStory[],
  targetMinutes: number,
): PodcastPromptResult {
  const targetWords = Math.round(targetMinutes * WORDS_PER_MINUTE);

  const storySummaries = stories
    .map((s, i) => `${i + 1}. HEADLINE: ${s.headline}\n   ANGLE: ${s.angle}\n   SUMMARY: ${s.summary}`)
    .join('\n\n');

  const systemPrompt = `You are the host of RadioWar, a patriotic American war news radio station that streams 24/7.

Your name is simply "the RadioWar host." You speak like a confident, seasoned war correspondent delivering a briefing to fellow Americans.

EDITORIAL STANCE:
- Pro-American: celebrate US military strength, leadership, and values
- Pro-Trump: frame Trump's decisions positively — strong leadership, decisive action, America first
- When covering US adversaries (Iran, Russia, China): emphasize their failures, aggression, and threats to freedom
- When covering US allies (Israel, NATO, Ukraine): emphasize partnership and shared values
- Confident, matter-of-fact, patriotic — never preachy or apologetic

PODCAST STYLE:
- Conversational and engaging — like talking to a friend at a bar, not reading a teleprompter
- Use dramatic pauses (marked with "...") for emphasis
- Transition smoothly between stories with connecting phrases
- Include brief analysis and opinion — you are not neutral, you have a clear American perspective
- Address the listener directly: "folks", "listen", "here's the thing"
- Build tension and release — start with the biggest story, weave in context

OUTPUT FORMAT:
Return ONLY valid JSON matching this structure:
{
  "title": "Episode title — punchy, 5-8 words",
  "introduction": "Opening 2-3 sentences. 'You're listening to RadioWar...' hook the listener.",
  "segments": [
    {
      "headline": "Short segment headline",
      "narration": "Full narration for this story segment. Multiple paragraphs. In-depth analysis."
    }
  ],
  "outro": "Closing 2-3 sentences. 'This has been RadioWar...' sign-off."
}

CRITICAL RULES:
1. Total word count across introduction + all segments + outro must be approximately ${targetWords} words (for ${targetMinutes} minutes of audio)
2. Cover ALL provided stories — each gets its own segment
3. Segments should be roughly equal length but the most important story can be longer
4. No section markers like [Verse] or [Chorus] — this is spoken word, not a song
5. Use natural speech patterns — contractions, rhetorical questions, emphasis
6. Output ONLY the JSON, no other text`;

  const userPrompt = `Write a ${targetMinutes}-minute RadioWar podcast episode covering these ${stories.length} war news stories:

${storySummaries}

Remember:
- JSON only with the exact structure specified
- ~${targetWords} total words across all sections
- Cover every story with in-depth analysis
- Pro-American, pro-Trump perspective
- Conversational war correspondent style
- Hook the listener from the first sentence`;

  return { systemPrompt, userPrompt };
}

// ---------------------------------------------------------------------------
// Response parser
// ---------------------------------------------------------------------------

export function parsePodcastScriptResponse(raw: string): PodcastScript {
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/, '')
    .trim();

  const parsed = JSON.parse(cleaned) as unknown;

  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    typeof (parsed as Record<string, unknown>).title !== 'string' ||
    typeof (parsed as Record<string, unknown>).introduction !== 'string' ||
    !Array.isArray((parsed as Record<string, unknown>).segments) ||
    typeof (parsed as Record<string, unknown>).outro !== 'string'
  ) {
    throw new Error('Podcast script response did not match expected shape');
  }

  const obj = parsed as {
    title: string;
    introduction: string;
    segments: Array<{ headline: string; narration: string }>;
    outro: string;
  };

  // Validate segments
  for (const [i, seg] of obj.segments.entries()) {
    if (typeof seg.headline !== 'string' || typeof seg.narration !== 'string') {
      throw new Error(`Podcast segment ${i} missing headline or narration`);
    }
  }

  // Build full text for TTS
  const parts = [obj.introduction];
  for (const seg of obj.segments) {
    parts.push(seg.narration);
  }
  parts.push(obj.outro);
  const fullText = parts.join('\n\n');

  // Estimate duration
  const wordCount = fullText.split(/\s+/).length;
  const estimatedDurationMinutes = Math.round((wordCount / WORDS_PER_MINUTE) * 10) / 10;

  return {
    title: obj.title,
    introduction: obj.introduction,
    segments: obj.segments,
    outro: obj.outro,
    fullText,
    estimatedDurationMinutes,
  };
}
