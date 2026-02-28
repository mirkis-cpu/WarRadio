#!/usr/bin/env npx tsx
/**
 * Test ONLY the download pipeline (no generation).
 * Uses cdn1.suno.ai with a known clip ID.
 */
import 'dotenv/config';
import path from 'path';
import { mkdirSync, statSync } from 'fs';
import { downloadAudio } from '../src/suno/downloader.js';

const CLIP_ID = 'f287d2d1-8e87-4e7f-845f-659a06b4bb32';
const AUDIO_URL = `https://cdn1.suno.ai/${CLIP_ID}.mp3`;
const OUTPUT_DIR = path.resolve('media/songs/2026-02-28');
const OUTPUT_PATH = path.join(OUTPUT_DIR, '001-thunder-over-persian-sand.mp3');

async function main() {
  mkdirSync(OUTPUT_DIR, { recursive: true });

  console.log(`Downloading from: ${AUDIO_URL}`);
  console.log(`Output: ${OUTPUT_PATH}\n`);

  const t = Date.now();
  await downloadAudio(AUDIO_URL, OUTPUT_PATH);

  const stat = statSync(OUTPUT_PATH);
  console.log(`\nDone in ${((Date.now() - t) / 1000).toFixed(1)}s`);
  console.log(`File size: ${(stat.size / 1024).toFixed(0)} KB`);
  console.log('SUCCESS!');
}

main().catch((err) => {
  console.error('Failed:', err);
  process.exit(1);
});
