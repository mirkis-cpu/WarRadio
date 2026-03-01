#!/usr/bin/env npx tsx
/**
 * Quick test: generate ONE song via Suno with visible browser.
 * Tests session auth + form fill + generation + download flow.
 *
 * Output: media/songs/YYYY-MM-DD/001-thunder-over-persian-sand.mp3
 */
import 'dotenv/config';
import path from 'path';
import { mkdirSync, readdirSync } from 'fs';
import { SunoSession } from '../src/suno/session.js';
import { SunoGenerator } from '../src/suno/generator.js';
import { downloadAudio } from '../src/suno/downloader.js';
import { getConfig } from '../src/config.js';

const SONGS_BASE = path.resolve(getConfig().MEDIA_DIR, 'songs');

function todayDir(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return path.join(SONGS_BASE, `${yyyy}-${mm}-${dd}`);
}

function nextIndex(dir: string): number {
  try {
    const files = readdirSync(dir).filter((f) => /^\d{3}-/.test(f));
    if (files.length === 0) return 1;
    const maxIdx = Math.max(...files.map((f) => parseInt(f.slice(0, 3), 10)));
    return maxIdx + 1;
  } catch {
    return 1;
  }
}

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
}

async function main() {
  console.log('=== Suno Single Song Test ===\n');

  const dir = todayDir();
  mkdirSync(dir, { recursive: true });

  // Init with VISIBLE browser
  console.log('Initializing Suno (visible browser)...');
  const session = new SunoSession();
  await session.initialize(false, 50); // headless=false, slowMo=50

  const isAuthed = await session.verifySession();
  console.log(`Session authenticated: ${isAuthed}`);

  if (!isAuthed) {
    console.log('\nSession expired or invalid. Trying to proceed anyway...');
    console.log('If it fails, run: npm run suno:login\n');
  }

  const generator = new SunoGenerator(session);

  const title = 'Thunder Over Persian Sand';
  console.log(`Generating: "${title}"...\n`);
  const t = Date.now();

  try {
    const result = await generator.generate({
      style: 'blues rock, guitar driven, gritty vocals, powerful',
      lyrics: `[Verse]
Thunder rolling cross the desert sand
Eagle's shadow covers every land
Steel and fire light up the night
America is standing right

[Chorus]
Thunder over Persian sand
Freedom marching hand in hand
Don't you test this promised land
Thunder over Persian sand

[Verse]
Bombers flying through the crimson sky
Old regime about to say goodbye
Stars and stripes upon the wind
A brand new chapter to begin

[Chorus]
Thunder over Persian sand
Freedom marching hand in hand
Don't you test this promised land
Thunder over Persian sand`,
      title,
    });

    console.log(`\nClip ID: ${result.clipId}`);
    console.log(`Audio URL: ${result.audioUrl}`);

    const idx = nextIndex(dir);
    const filename = `${String(idx).padStart(3, '0')}-${slugify(title)}.mp3`;
    const outputPath = path.join(dir, filename);

    await downloadAudio(result.audioUrl, outputPath);
    console.log(`\nDownloaded to: ${outputPath}`);
    console.log(`Time: ${((Date.now() - t) / 1000).toFixed(1)}s`);
    console.log('\nSUCCESS!');
  } catch (err) {
    console.error('\nFailed:', err);
    console.log('\nKeeping browser open for debugging. Press Ctrl+C to exit.');
    await new Promise(() => {});
  }

  await session.destroy();
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
