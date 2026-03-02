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
    name: 'boom-bap',
    sunoStyle: 'boom bap, 90s hip hop, vinyl crackle, jazzy samples, hard drums, conscious rap, storytelling',
    claudePersonality: 'veteran street journalist rapper spitting raw truth about war like a 90s NYC MC — vivid imagery, punchlines, wordplay',
    verseCount: 3, hasChorus: true, hasBridge: true, weight: 8,
  },
  {
    name: 'trap',
    sunoStyle: 'trap, 808 bass, dark hi-hats, atmospheric, hard-hitting, aggressive flow, modern rap',
    claudePersonality: 'aggressive modern rapper turning war chaos into hard-hitting trap anthems — short punchy bars, ad-libs, intensity',
    verseCount: 2, hasChorus: true, hasBridge: false, weight: 7,
  },
  {
    name: 'lofi-hiphop',
    sunoStyle: 'lo-fi hip hop, chill beats, vinyl crackle, jazz piano samples, mellow, relaxing, downtempo rap',
    claudePersonality: 'reflective poet-rapper delivering war commentary over chill beats — introspective, smooth flow, melancholic wisdom',
    verseCount: 2, hasChorus: true, hasBridge: false, weight: 8,
  },
  {
    name: 'drill',
    sunoStyle: 'UK drill, sliding 808s, dark piano, aggressive, fast flow, gritty, menacing beat',
    claudePersonality: 'frontline war reporter turned drill MC — rapid-fire bars about battlefield reality, no sugar coating, raw and menacing',
    verseCount: 2, hasChorus: true, hasBridge: false, weight: 5,
  },
  {
    name: 'melodic-rap',
    sunoStyle: 'melodic rap, auto-tune vocals, emotional, atmospheric synths, modern R&B hip hop, catchy hooks',
    claudePersonality: 'emotional melodic rapper singing about the human cost of war — refugees, families torn apart, hope in darkness',
    verseCount: 2, hasChorus: true, hasBridge: true, weight: 6,
  },
  {
    name: 'conscious-rap',
    sunoStyle: 'conscious hip hop, soulful samples, live drums, spoken word, political rap, powerful delivery',
    claudePersonality: 'political conscious rapper like Kendrick/Immortal Technique — deep analysis of war, power structures, propaganda, systemic critique',
    verseCount: 3, hasChorus: true, hasBridge: true, weight: 6,
  },
];
