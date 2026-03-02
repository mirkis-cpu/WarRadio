#!/usr/bin/env npx tsx
/**
 * Test: Generate one podcast episode from today's news.
 */
import 'dotenv/config';
import { RssService } from '../src/services/rss-service.js';
import { LyricsService } from '../src/services/lyrics-service.js';
import { PodcastService } from '../src/services/podcast-service.js';

async function main() {
  console.log('=== Podcast Episode Test ===\n');

  // Step 1: Fetch news
  console.log('Step 1: Fetching RSS feeds...');
  const rss = new RssService();
  const articles = await rss.fetchOnce();
  console.log(`  Got ${articles.length} articles\n`);

  if (articles.length === 0) {
    console.error('No articles found! Check RSS feeds.');
    process.exit(1);
  }

  // Step 2: Synthesize stories
  console.log('Step 2: Synthesizing news into stories (Claude)...');
  const lyrics = new LyricsService();
  const stories = await lyrics.synthesizeNews(articles, 10);
  console.log(`  Got ${stories.length} stories:`);
  for (const s of stories) {
    console.log(`    - ${s.headline}`);
  }
  console.log();

  // Step 3: Generate podcast
  console.log('Step 3: Generating podcast episode (Claude + edge-tts)...');
  const podcast = new PodcastService();
  const t = Date.now();
  const episode = await podcast.generateEpisode(stories);
  const elapsed = ((Date.now() - t) / 1000).toFixed(1);

  console.log('\n=== Result ===');
  console.log(`  Title:    ${episode.title}`);
  console.log(`  Duration: ~${episode.durationEstimateMinutes} min`);
  console.log(`  Stories:  ${episode.storyCount}`);
  console.log(`  Audio:    ${episode.audioPath}`);
  console.log(`  Time:     ${elapsed}s`);
  console.log(`\nScript preview (first 500 chars):\n${episode.scriptText.slice(0, 500)}...`);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
