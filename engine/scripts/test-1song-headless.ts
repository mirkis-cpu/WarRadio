#!/usr/bin/env npx tsx
import 'dotenv/config';
import path from 'path';
import { mkdirSync, readdirSync } from 'fs';
import { SunoSession } from '../src/suno/session.js';
import { SunoGenerator } from '../src/suno/generator.js';
import { downloadAudio } from '../src/suno/downloader.js';
import { getConfig } from '../src/config.js';

const SONGS_BASE = path.resolve(getConfig().MEDIA_DIR, 'songs');
function todayDir() {
  const d = new Date();
  return path.join(SONGS_BASE, `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`);
}
function nextIndex(dir: string) {
  try {
    const files = readdirSync(dir).filter(f => /^\d{3}-/.test(f));
    if (!files.length) return 1;
    return Math.max(...files.map(f => parseInt(f.slice(0,3),10))) + 1;
  } catch { return 1; }
}
function slugify(t: string) {
  return t.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,60);
}

async function main() {
  console.log('=== 1 Song Headless Test ===\n');
  const dir = todayDir();
  mkdirSync(dir, { recursive: true });

  const session = new SunoSession();
  await session.initialize(true, 0);
  const isAuthed = await session.verifySession();
  console.log(`Auth: ${isAuthed}`);
  if (!isAuthed) { await session.destroy(); process.exit(1); }

  const generator = new SunoGenerator(session);
  const title = 'Steel Rain Falling';
  const t = Date.now();

  try {
    const result = await generator.generate({
      style: 'country rock, twangy guitar, steady drums, patriotic anthem',
      lyrics: `[Verse]
Steel rain falling from the sky tonight
Bomber jets blazing through the fading light
Old glory waving on the desert ground
Freedom has a heavy sound

[Chorus]
Steel rain falling down on foreign land
Uncle Sam extending his iron hand
You can run but you will never hide
Steel rain falling on the other side

[Verse]
Soldiers marching through the morning haze
Setting every tyrant's world ablaze
Back home mama's praying on her knees
Bring my baby back to me

[Chorus]
Steel rain falling down on foreign land
Uncle Sam extending his iron hand
You can run but you will never hide
Steel rain falling on the other side`,
      title,
    });

    console.log(`\nClip: ${result.clipId}`);
    console.log(`URL: ${result.audioUrl}`);

    const idx = nextIndex(dir);
    const out = path.join(dir, `${String(idx).padStart(3,'0')}-${slugify(title)}.mp3`);
    await downloadAudio(result.audioUrl, out);
    console.log(`Downloaded: ${out}`);
    console.log(`Time: ${((Date.now()-t)/1000).toFixed(1)}s`);
    console.log('SUCCESS!');
  } catch (err) {
    console.error('FAILED:', err);
  }

  await session.destroy();
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
