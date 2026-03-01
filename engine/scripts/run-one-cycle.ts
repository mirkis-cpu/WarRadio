/**
 * Run a single production cycle: RSS → Synthesis → Lyrics → Suno generation
 */
import 'dotenv/config';
import { Pipeline } from '../src/services/pipeline.js';

async function main() {
  const pipeline = new Pipeline();

  console.log('Starting single production cycle...');
  const result = await pipeline.runSingleCycle();

  console.log('\n═══ Cycle Result ═══');
  console.log(`  Articles scraped: ${result.articlesScraped}`);
  console.log(`  Stories synthesized: ${result.storiesSynthesized}`);
  console.log(`  Lyrics generated: ${result.lyricsGenerated}`);
  console.log(`  Songs produced: ${result.songsProduced}`);
  if (result.errors.length > 0) {
    console.log(`  Errors (${result.errors.length}):`);
    for (const err of result.errors) {
      console.log(`    - ${err}`);
    }
  }

  await pipeline.stop();
  process.exit(0);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
