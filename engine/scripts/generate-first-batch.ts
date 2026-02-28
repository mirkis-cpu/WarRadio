#!/usr/bin/env npx tsx
/**
 * Generate the first batch of 10 songs for RadioWar.
 * Full pipeline: RSS → Claude Synthesis → Claude Lyrics → Suno Generation
 *
 * Usage: npx tsx scripts/generate-first-batch.ts
 */
import 'dotenv/config';
import path from 'path';
import { mkdirSync, existsSync } from 'fs';
import { nanoid } from 'nanoid';
import { RssService } from '../src/services/rss-service.js';
import { LyricsService, type GeneratedLyrics } from '../src/services/lyrics-service.js';
import { SunoSession } from '../src/suno/session.js';
import { SunoGenerator } from '../src/suno/generator.js';
import { downloadAudio } from '../src/suno/downloader.js';
import { getConfig } from '../src/config.js';

const SONG_COUNT = 10;
const SUNO_CONCURRENCY = 2;
const MEDIA_DIR = getConfig().MEDIA_DIR;
const SONGS_DIR = path.join(MEDIA_DIR, 'songs');

async function main() {
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║     RadioWar — First Batch Song Generation       ║');
  console.log('╚══════════════════════════════════════════════════╝\n');

  mkdirSync(SONGS_DIR, { recursive: true });

  // ── Phase 1: RSS ─────────────────────────────────────────────────────────
  console.log('Phase 1: Fetching RSS feeds...');
  const rss = new RssService();
  const t1 = Date.now();
  const articles = await rss.fetchOnce();
  console.log(`  → ${articles.length} articles in ${sec(t1)}s\n`);

  if (articles.length === 0) {
    console.error('No articles found. Exiting.');
    process.exit(1);
  }

  // ── Phase 2: Claude Synthesis ────────────────────────────────────────────
  console.log(`Phase 2: Synthesizing into ${SONG_COUNT} stories...`);
  const lyrics = new LyricsService();
  const t2 = Date.now();
  const stories = await lyrics.synthesizeNews(articles, SONG_COUNT);
  console.log(`  → ${stories.length} stories in ${sec(t2)}s\n`);

  for (const [i, s] of stories.entries()) {
    console.log(`  ${i + 1}. ${s.headline}`);
  }
  console.log();

  // ── Phase 3: Lyrics Generation ───────────────────────────────────────────
  console.log('Phase 3: Generating lyrics...');
  const t3 = Date.now();
  const allLyrics = await lyrics.batchGenerateLyrics(stories);
  console.log(`  → ${allLyrics.length} lyrics in ${sec(t3)}s\n`);

  for (const [i, l] of allLyrics.entries()) {
    console.log(`  ${i + 1}. "${l.title}" [${l.genre.name}] — ${l.storyHeadline}`);
  }
  console.log();

  // ── Phase 4: Suno Generation ─────────────────────────────────────────────
  console.log('Phase 4: Initializing Suno (visible browser)...');
  const session = new SunoSession();
  await session.initialize(false); // visible browser for debugging

  const isAuthed = await session.verifySession();
  if (!isAuthed) {
    console.error('Suno session not authenticated! Run: npm run suno:login');
    await session.destroy();
    process.exit(1);
  }
  console.log('  Suno authenticated ✓\n');

  const generator = new SunoGenerator(session);
  const results: { title: string; file: string; clipId: string }[] = [];
  const errors: string[] = [];

  console.log(`Generating ${allLyrics.length} songs (${SUNO_CONCURRENCY} at a time)...\n`);

  for (let i = 0; i < allLyrics.length; i += SUNO_CONCURRENCY) {
    const batch = allLyrics.slice(i, i + SUNO_CONCURRENCY);
    const batchNum = Math.floor(i / SUNO_CONCURRENCY) + 1;
    const totalBatches = Math.ceil(allLyrics.length / SUNO_CONCURRENCY);

    console.log(`  Batch ${batchNum}/${totalBatches}: ${batch.map((l) => `"${l.title}"`).join(', ')}`);

    const batchResults = await Promise.allSettled(
      batch.map((l) => generateSong(generator, l)),
    );

    for (const [j, result] of batchResults.entries()) {
      const l = batch[j];
      if (result.status === 'fulfilled') {
        results.push(result.value);
        console.log(`    ✓ "${l.title}" → ${result.value.file}`);
      } else {
        const msg = `"${l.title}": ${String(result.reason)}`;
        errors.push(msg);
        console.log(`    ✗ ${msg}`);
      }
    }
    console.log();
  }

  await session.destroy();

  // ── Summary ──────────────────────────────────────────────────────────────
  const totalTime = sec(t1);
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║                   SUMMARY                        ║');
  console.log('╠══════════════════════════════════════════════════╣');
  console.log(`║  Total time:     ${totalTime}s`);
  console.log(`║  Articles:       ${articles.length}`);
  console.log(`║  Stories:        ${stories.length}`);
  console.log(`║  Lyrics:         ${allLyrics.length}`);
  console.log(`║  Songs produced: ${results.length}`);
  console.log(`║  Errors:         ${errors.length}`);
  console.log('╚══════════════════════════════════════════════════╝\n');

  if (results.length > 0) {
    console.log('Generated songs:');
    for (const r of results) {
      console.log(`  ${r.file}`);
    }
  }

  if (errors.length > 0) {
    console.log('\nErrors:');
    for (const e of errors) {
      console.log(`  ${e}`);
    }
  }

  console.log(`\n${results.length} songs ready for streaming.`);
}

async function generateSong(
  generator: SunoGenerator,
  l: GeneratedLyrics,
): Promise<{ title: string; file: string; clipId: string }> {
  const id = nanoid();
  const outputPath = path.join(SONGS_DIR, `${id}.mp3`);

  const result = await generator.generate({
    style: l.genre.sunoStyle,
    lyrics: l.lyrics,
    title: l.title,
  });

  await downloadAudio(result.audioUrl, outputPath);

  return { title: l.title, file: outputPath, clipId: result.clipId };
}

function sec(from: number): string {
  return ((Date.now() - from) / 1000).toFixed(1);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
