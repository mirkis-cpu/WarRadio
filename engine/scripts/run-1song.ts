#!/usr/bin/env npx tsx
/**
 * Full pipeline for 1 song: RSS → Synthesis → Lyrics → Suno → Download
 */
import 'dotenv/config';
import path from 'path';
import { mkdirSync, readdirSync } from 'fs';
import { getConfig } from '../src/config.js';
import { RssService } from '../src/services/rss-service.js';
import { LyricsService } from '../src/services/lyrics-service.js';
import { SunoSession } from '../src/suno/session.js';
import { SunoGenerator } from '../src/suno/generator.js';
import { downloadAudio } from '../src/suno/downloader.js';

const SONGS_BASE = path.resolve(getConfig().MEDIA_DIR, 'songs');

function todayDir() {
  const d = new Date();
  return path.join(
    SONGS_BASE,
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
  );
}

function nextIndex(dir: string) {
  try {
    const files = readdirSync(dir).filter((f) => /^\d{3}-/.test(f));
    if (!files.length) return 1;
    return Math.max(...files.map((f) => parseInt(f.slice(0, 3), 10))) + 1;
  } catch {
    return 1;
  }
}

function slugify(t: string) {
  return t
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
}

async function main() {
  console.log('═══ RadioWar: 1 Song Pipeline ═══\n');

  // ── Phase 1: RSS ──
  console.log('Phase 1: Fetching RSS feeds...');
  const rss = new RssService();
  const articles = await rss.fetchOnce();
  console.log(`  → ${articles.length} articles fetched\n`);

  if (articles.length === 0) {
    console.error('No articles found, aborting.');
    process.exit(1);
  }

  // ── Phase 2: Synthesis (1 story) ──
  console.log('Phase 2: Synthesizing 1 news story...');
  const lyricsService = new LyricsService();
  const stories = await lyricsService.synthesizeNews(articles, 1);
  console.log(`  → Story: "${stories[0]?.headline}"`);
  console.log(`  → Angle: ${stories[0]?.angle}\n`);

  if (stories.length === 0) {
    console.error('Synthesis failed, no stories produced.');
    process.exit(1);
  }

  // ── Phase 3: Lyrics ──
  console.log('Phase 3: Generating lyrics...');
  const lyrics = await lyricsService.generateLyricsFromStory(stories[0]);
  console.log(`  → Title: "${lyrics.title}"`);
  console.log(`  → Genre: ${lyrics.genre.name}`);
  console.log(`  → Style: ${lyrics.genre.sunoStyle}\n`);

  // ── Phase 4: Suno Generation ──
  console.log('Phase 4: Initializing Suno...');
  const session = new SunoSession();
  await session.initialize(false, 0); // visible browser for debugging
  const isAuthed = await session.verifySession();
  console.log(`  → Auth: ${isAuthed}`);

  if (!isAuthed) {
    console.error('Suno not authenticated. Run: npm run suno:login');
    await session.destroy();
    process.exit(1);
  }

  const generator = new SunoGenerator(session);
  const t = Date.now();

  console.log(`  → Generating song on Suno...`);
  try {
    const result = await generator.generate({
      style: lyrics.genre.sunoStyle,
      lyrics: lyrics.lyrics,
      title: lyrics.title,
    });

    console.log(`  → Clip: ${result.clipId}`);
    console.log(`  → URL: ${result.audioUrl}\n`);

    // ── Phase 5: Download ──
    const dir = todayDir();
    mkdirSync(dir, { recursive: true });
    const idx = nextIndex(dir);
    const out = path.join(dir, `${String(idx).padStart(3, '0')}-${slugify(lyrics.title)}.mp3`);
    await downloadAudio(result.audioUrl, out);

    const elapsed = ((Date.now() - t) / 1000).toFixed(1);
    console.log('═══ DONE ═══');
    console.log(`  Title:    ${lyrics.title}`);
    console.log(`  Genre:    ${lyrics.genre.name}`);
    console.log(`  Headline: ${lyrics.storyHeadline}`);
    console.log(`  File:     ${out}`);
    console.log(`  Time:     ${elapsed}s`);
  } catch (err) {
    console.error('Song generation FAILED:', err);
  }

  await session.destroy();
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
