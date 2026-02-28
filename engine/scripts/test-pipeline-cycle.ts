#!/usr/bin/env npx tsx
/**
 * Test a full production cycle WITHOUT Suno:
 *   RSS Fetch → Claude Synthesis → Claude Lyrics
 *
 * Usage: ANTHROPIC_API_KEY=sk-ant-... npx tsx scripts/test-pipeline-cycle.ts
 */
import { RssService } from '../src/services/rss-service.js';
import { LyricsService } from '../src/services/lyrics-service.js';

const SONG_COUNT = 10;

async function main() {
  console.log('=== RadioWar Pipeline Cycle Test ===\n');

  if (!process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY.startsWith('sk-ant-test')) {
    console.error('ERROR: Set a real ANTHROPIC_API_KEY to test the pipeline.');
    console.error('Usage: ANTHROPIC_API_KEY=sk-ant-... npx tsx scripts/test-pipeline-cycle.ts');
    process.exit(1);
  }

  const rss = new RssService();
  const lyrics = new LyricsService();

  // ── Phase 1: RSS Fetch ──────────────────────────────────────────────────
  console.log('Phase 1: Fetching RSS feeds...');
  const t1 = Date.now();
  const articles = await rss.fetchOnce();
  console.log(`  → ${articles.length} war-related articles in ${((Date.now() - t1) / 1000).toFixed(1)}s\n`);

  if (articles.length === 0) {
    console.error('No articles found. Exiting.');
    process.exit(1);
  }

  // ── Phase 2: Claude Synthesis ─────────────────────────────────────────────
  console.log(`Phase 2: Synthesizing ${articles.length} articles into ${SONG_COUNT} stories...`);
  const t2 = Date.now();
  const stories = await lyrics.synthesizeNews(articles, SONG_COUNT);
  console.log(`  → ${stories.length} stories in ${((Date.now() - t2) / 1000).toFixed(1)}s\n`);

  console.log('--- Synthesized Stories ---');
  for (const [i, story] of stories.entries()) {
    console.log(`  ${i + 1}. [imp:${story.importance}] ${story.headline}`);
    console.log(`     Angle: ${story.angle}`);
    console.log(`     ${story.summary.slice(0, 150)}${story.summary.length > 150 ? '...' : ''}`);
    console.log(`     Sources: ${story.sourceArticleIds.length} article(s)\n`);
  }

  // ── Phase 3: Batch Lyrics ────────────────────────────────────────────────
  console.log(`Phase 3: Generating ${stories.length} song lyrics...`);
  const t3 = Date.now();
  const allLyrics = await lyrics.batchGenerateLyrics(stories);
  console.log(`  → ${allLyrics.length} lyrics in ${((Date.now() - t3) / 1000).toFixed(1)}s\n`);

  console.log('--- Generated Songs ---');
  const genreCounts = new Map<string, number>();
  for (const [i, l] of allLyrics.entries()) {
    genreCounts.set(l.genre.name, (genreCounts.get(l.genre.name) ?? 0) + 1);

    console.log(`  ${i + 1}. "${l.title}" [${l.genre.name}]`);
    console.log(`     Story: ${l.storyHeadline}`);

    // Print first 3 lines of lyrics
    const lines = l.lyrics.split('\n').filter((line) => line.trim()).slice(0, 4);
    for (const line of lines) {
      console.log(`     ${line}`);
    }
    console.log();
  }

  // ── Summary ──────────────────────────────────────────────────────────────
  const totalTime = ((Date.now() - t1) / 1000).toFixed(1);
  console.log('=== Summary ===');
  console.log(`  Total time: ${totalTime}s`);
  console.log(`  Articles scraped: ${articles.length}`);
  console.log(`  Stories synthesized: ${stories.length}`);
  console.log(`  Lyrics generated: ${allLyrics.length}`);
  console.log(`  Genre distribution: ${[...genreCounts.entries()].map(([g, c]) => `${g}:${c}`).join(', ')}`);
  console.log(`\n  Ready for Suno generation (${allLyrics.length} songs × ~3min = ~${allLyrics.length * 3}min content)`);
  console.log('\n=== Done ===');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
