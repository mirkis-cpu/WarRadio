#!/usr/bin/env npx tsx
/**
 * Generate 5 songs from today's top war news — headless.
 */
import 'dotenv/config';
import path from 'path';
import { mkdirSync, readdirSync, statSync } from 'fs';
import { SunoSession } from '../src/suno/session.js';
import { SunoGenerator } from '../src/suno/generator.js';
import { downloadAudio } from '../src/suno/downloader.js';
import { getConfig } from '../src/config.js';

const SONGS_BASE = path.resolve(getConfig().MEDIA_DIR, 'songs');

function todayDir() {
  const d = new Date();
  return path.join(SONGS_BASE, `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
}

function nextIndex(dir: string) {
  try {
    const files = readdirSync(dir).filter(f => /^\d{3}-/.test(f));
    if (!files.length) return 1;
    return Math.max(...files.map(f => parseInt(f.slice(0, 3), 10))) + 1;
  } catch { return 1; }
}

function slugify(t: string) {
  return t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
}

const SONGS = [
  {
    title: 'Bombs Over Tehran',
    style: 'punk rock, distorted guitar, fast tempo, aggressive, raw energy, 1980s punk',
    lyrics: `[Verse]
Sirens screaming over ancient streets
Fighter jets are bringing hell's own heat
Pentagon gave the order late last night
Stars and stripes are locked and loaded tight

[Chorus]
Bombs over Tehran the sky is burning red
Bombs over Tehran hear every word we said
Don't push America we'll push you to the ground
Bombs over Tehran that freedom shaking sound

[Verse]
Mullahs running from their palace walls
Every bunker buster breaks and falls
Israel standing shoulder next to us
Two nations bringing down the tyrant's dust

[Chorus]
Bombs over Tehran the sky is burning red
Bombs over Tehran hear every word we said
Don't push America we'll push you to the ground
Bombs over Tehran that freedom shaking sound

[Outro]
Tehran is shaking and the world can see
This is what happens when you threaten the free`,
  },
  {
    title: 'Missiles In The Night',
    style: 'dark synth, electronic, industrial, driving beat, atmospheric, dystopian',
    lyrics: `[Verse]
Radar screens are glowing hot tonight
Iranian rockets cutting through the light
Bahrain base is taking heavy fire
Dubai skyline wrapped in smoke and wire

[Chorus]
Missiles in the night they tried to make us bleed
Missiles in the night but we will not concede
Iron Dome is holding patriots stand tall
Missiles in the night we will not fall

[Bridge]
Hotel burning on the Palm tonight
Civilians running from the blinding light
But every rocket makes us stronger still
America bends but never breaks its will

[Chorus]
Missiles in the night they tried to make us bleed
Missiles in the night but we will not concede
Iron Dome is holding patriots stand tall
Missiles in the night we will not fall

[Outro]
Fire back fire back light up the desert sky
America don't run America don't die`,
  },
  {
    title: 'Tear The Regime Down',
    style: 'hip hop, boom bap, conscious rap, hard-hitting beats, storytelling flow',
    lyrics: `[Verse]
Trump on the screen eight minutes strong
Telling every Iranian what's been wrong
Forty-five years under iron fist
Time to rise up time to resist
Students marching through the campus gates
Protesting a government that they all hate
The supreme leader hiding underground
While American thunder shakes the ground

[Chorus]
Tear the regime down brick by brick
People power rising quick
Tear the regime down wall by wall
Watch the dictators fall

[Verse]
Mama praying in the Tehran streets
No more internet just smoke and heat
But the spirit cannot be contained
When freedom's fire runs through every vein
From the mountains to the Persian Gulf
People tired of this tyrant's bluff
America said we'll light the spark
The people do the rest after dark

[Chorus]
Tear the regime down brick by brick
People power rising quick
Tear the regime down wall by wall
Watch the dictators fall

[Bridge]
Revolution is a people's right
When your government won't treat you right`,
  },
  {
    title: 'Open War On The Border',
    style: 'country, twang guitar, acoustic, heartfelt storytelling, Americana',
    lyrics: `[Verse]
Pakistan jets flew at the break of dawn
Crossing borders that the Taliban call home
Afghanistan fired first upon the line
Now two nations drawing battle signs
Months of tension finally broke apart
Khyber Pass is bleeding from the heart

[Chorus]
Open war on the border blood and stone
Two old neighbors fighting for their own
Bullets flying where the merchants used to trade
Open war on the border lines are made

[Verse]
Taliban refined their deadly game
Roadside bombs and sniper fire and flame
Pakistan with jets and tanks and steel
Overwhelming force that makes the mountains reel
But there ain't no winning in this fight
Just more graves beneath the Hindu Kush tonight

[Chorus]
Open war on the border blood and stone
Two old neighbors fighting for their own
Bullets flying where the merchants used to trade
Open war on the border lines are made

[Outro]
Lord have mercy on the borderlands
Blood keeps soaking through the desert sands`,
  },
  {
    title: 'Chaos In The Capital',
    style: 'delta blues, slide guitar, soulful vocals, slow groove, raw emotion',
    lyrics: `[Verse]
Monday morning Tehran woke up wrong
Sound of bombers singing Satan's song
Mama grabbed her children running fast
Praying God would let this moment pass
Schools were hit and buildings turned to dust
Nothing left but ashes fear and rust

[Verse]
Internet went dark across the land
Government won't lend a helping hand
Abandoned by the leaders that they chose
Iranians standing in their tattered clothes
Some are crying some are feeling free
Maybe this is how it has to be

[Verse]
World is watching on their TV screens
Trying to figure out what all this means
But down there in the rubble and the pain
Simple people walking through the rain
Chaos in the capital tonight
Somewhere in the dark there might be light`,
  },
];

async function main() {
  console.log('=== 5 News Songs Generation (Headless) ===\n');

  const dir = todayDir();
  mkdirSync(dir, { recursive: true });
  console.log(`Output: ${dir}\n`);

  const session = new SunoSession();
  await session.initialize(false, 50); // visible browser for manual captcha

  const isAuthed = await session.verifySession();
  console.log(`Auth: ${isAuthed}`);
  if (!isAuthed) {
    console.error('Not authenticated! Run: npm run suno:login');
    await session.destroy();
    process.exit(1);
  }

  const generator = new SunoGenerator(session);
  const results: { title: string; file: string; time: number }[] = [];

  for (let i = 0; i < SONGS.length; i++) {
    const song = SONGS[i];
    console.log(`\n--- [${i + 1}/${SONGS.length}] "${song.title}" ---`);
    const t = Date.now();

    try {
      const result = await generator.generate({
        style: song.style,
        lyrics: song.lyrics,
        title: song.title,
      });

      const idx = nextIndex(dir);
      const filename = `${String(idx).padStart(3, '0')}-${slugify(song.title)}.mp3`;
      const outputPath = path.join(dir, filename);

      await downloadAudio(result.audioUrl, outputPath);
      const size = statSync(outputPath).size;
      const elapsed = (Date.now() - t) / 1000;

      results.push({ title: song.title, file: filename, time: elapsed });
      console.log(`  OK: ${filename} (${(size / 1024).toFixed(0)} KB, ${elapsed.toFixed(0)}s)`);
    } catch (err) {
      console.error(`  FAIL: ${song.title}`, err);
    }
  }

  console.log('\n=== Results ===');
  for (const r of results) {
    console.log(`  ${r.file} (${r.time.toFixed(0)}s)`);
  }
  console.log(`\n${results.length}/${SONGS.length} songs generated.`);

  await session.destroy();
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
