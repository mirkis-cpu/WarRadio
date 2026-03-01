#!/usr/bin/env npx tsx
/**
 * Test: generate 2 songs in HEADLESS mode.
 * Verifies the full pipeline: session → generate → poll cdn1 → download.
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

const SONGS = [
  {
    title: 'Iron Eagle Rising',
    style: 'hard rock, heavy guitar riffs, aggressive drums, anthemic',
    lyrics: `[Verse]
Iron wings across the morning sky
Engines roaring battle cry
Desert storm is closing in
Time to let the war begin

[Chorus]
Iron eagle rising high
Fire and steel light up the sky
No retreat and no surrender
Iron eagle rising high

[Verse]
Radar locked and missiles hot
Give it everything we got
Stars and stripes upon the tail
Freedom's force will never fail

[Chorus]
Iron eagle rising high
Fire and steel light up the sky
No retreat and no surrender
Iron eagle rising high`,
  },
  {
    title: 'Midnight Over Damascus',
    style: 'dark synthwave, pulsing bass, electronic drums, cinematic tension',
    lyrics: `[Verse]
Shadows move through ancient streets
Digital pulse and concrete beats
Satellite eyes watch from above
War machine removing the glove

[Chorus]
Midnight over Damascus falling
Sirens in the distance calling
Neon lights on broken walls
Midnight over Damascus falls

[Verse]
Drone strikes painting crimson lines
Crossing all the border signs
Screen glow in the command room
Sealing everybody's doom

[Chorus]
Midnight over Damascus falling
Sirens in the distance calling
Neon lights on broken walls
Midnight over Damascus falls`,
  },
];

async function main() {
  console.log('=== Headless 2-Song Test ===\n');

  const dir = todayDir();
  mkdirSync(dir, { recursive: true });

  // HEADLESS mode, no slowMo
  console.log('Initializing Suno session (headless)...');
  const session = new SunoSession();
  await session.initialize(true, 0);

  const isAuthed = await session.verifySession();
  console.log(`Session authenticated: ${isAuthed}`);
  if (!isAuthed) {
    console.error('Session not authenticated! Run: npm run suno:login');
    await session.destroy();
    process.exit(1);
  }

  const generator = new SunoGenerator(session);

  for (let i = 0; i < SONGS.length; i++) {
    const song = SONGS[i];
    console.log(`\n--- Song ${i + 1}/${SONGS.length}: "${song.title}" ---`);
    const t = Date.now();

    try {
      const result = await generator.generate({
        style: song.style,
        lyrics: song.lyrics,
        title: song.title,
      });

      console.log(`Clip ID: ${result.clipId}`);
      console.log(`Audio URL: ${result.audioUrl}`);

      const idx = nextIndex(dir);
      const filename = `${String(idx).padStart(3, '0')}-${slugify(song.title)}.mp3`;
      const outputPath = path.join(dir, filename);

      await downloadAudio(result.audioUrl, outputPath);
      console.log(`Downloaded: ${outputPath}`);
      console.log(`Time: ${((Date.now() - t) / 1000).toFixed(1)}s`);
    } catch (err) {
      console.error(`FAILED: ${song.title}`, err);
      // Take debug screenshot
      try {
        const debugPage = await session.newPage();
        await debugPage.screenshot({ path: `./media/debug/headless-fail-${i}.png` });
        await debugPage.close();
      } catch { /* ignore */ }
    }
  }

  console.log('\n=== Done ===');
  await session.destroy();
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
