#!/usr/bin/env npx tsx
import 'dotenv/config';
import { RssService } from '../src/services/rss-service.js';

async function main() {
  const rss = new RssService();
  console.log('Fetching war news from RSS feeds...\n');
  
  const articles = await rss.fetchOnce();
  
  console.log(`Found ${articles.length} war-related articles:\n`);
  
  for (let i = 0; i < articles.length; i++) {
    const a = articles[i];
    console.log(`${i + 1}. [${a.source}] ${a.title}`);
    if (a.description) console.log(`   ${a.description.slice(0, 150)}...`);
    console.log();
  }
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
