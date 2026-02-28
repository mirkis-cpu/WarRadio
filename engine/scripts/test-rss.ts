#!/usr/bin/env npx tsx
/**
 * Quick test: fetch all RSS feeds once and print war-related articles.
 * Usage: npx tsx scripts/test-rss.ts
 */

// Set dummy env vars so config doesn't crash (RSS doesn't need them)
process.env.ANTHROPIC_API_KEY ??= 'sk-ant-test-dummy';

import { RssService } from '../src/services/rss-service.js';

async function main() {
  console.log('=== RadioWar RSS Scraper Test ===\n');

  const rss = new RssService();

  console.log('Fetching all feeds...\n');
  const start = Date.now();

  const articles = await rss.fetchOnce();

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`\nFetched ${articles.length} war-related articles in ${elapsed}s\n`);

  // Group by source
  const bySource = new Map<string, typeof articles>();
  for (const a of articles) {
    const list = bySource.get(a.source) ?? [];
    list.push(a);
    bySource.set(a.source, list);
  }

  for (const [source, items] of bySource) {
    console.log(`\n--- ${source} (${items.length} articles) ---`);
    for (const item of items.slice(0, 5)) {
      console.log(`  [${item.publishedAt.toISOString().slice(0, 16)}] ${item.title}`);
      if (item.description) {
        const desc = item.description.slice(0, 120);
        console.log(`    ${desc}${item.description.length > 120 ? '...' : ''}`);
      }
    }
    if (items.length > 5) {
      console.log(`  ... and ${items.length - 5} more`);
    }
  }

  console.log('\n=== Done ===');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
