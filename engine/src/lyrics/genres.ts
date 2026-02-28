export interface GenreDefinition {
  name: string;
  sunoStyle: string;
  claudePersonality: string;
  verseCount: number;
  hasChorus: boolean;
  hasBridge: boolean;
  weight: number;
}

export const GENRES: GenreDefinition[] = [
  {
    name: 'punk-rock',
    sunoStyle: 'punk rock, distorted guitar, fast tempo, aggressive, raw energy, 1980s punk',
    claudePersonality: 'angry punk band writing protest songs about government failure and war profiteering',
    verseCount: 2, hasChorus: true, hasBridge: false, weight: 5,
  },
  {
    name: 'rap',
    sunoStyle: 'hip hop, boom bap, conscious rap, hard-hitting beats, storytelling flow',
    claudePersonality: 'street journalist rapper turning war dispatches into bars with vivid imagery and wordplay',
    verseCount: 3, hasChorus: true, hasBridge: true, weight: 5,
  },
  {
    name: 'folk',
    sunoStyle: 'acoustic folk, fingerpicking guitar, storytelling, melancholic, Bob Dylan-esque',
    claudePersonality: 'traveling folk singer bearing witness to conflict, melancholic but hopeful, poetic imagery',
    verseCount: 3, hasChorus: true, hasBridge: false, weight: 5,
  },
  {
    name: 'electronic',
    sunoStyle: 'dark synth, electronic, industrial, driving beat, atmospheric, dystopian',
    claudePersonality: 'cyberpunk poet writing about the machinery of war, surveillance states, and digital battlefields',
    verseCount: 2, hasChorus: true, hasBridge: true, weight: 5,
  },
  {
    name: 'blues',
    sunoStyle: 'delta blues, slide guitar, soulful vocals, slow groove, raw emotion',
    claudePersonality: 'blues musician singing about loss, displacement, and resilience of conflict survivors',
    verseCount: 3, hasChorus: false, hasBridge: false, weight: 3,
  },
  {
    name: 'country',
    sunoStyle: 'country, twang guitar, acoustic, heartfelt storytelling, Americana',
    claudePersonality: 'country songwriter telling the human stories behind war headlines, small-town perspective',
    verseCount: 2, hasChorus: true, hasBridge: false, weight: 3,
  },
];
