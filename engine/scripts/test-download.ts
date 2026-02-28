#!/usr/bin/env npx tsx
/**
 * Test: find the real audio URL from Suno song page and download.
 */
import 'dotenv/config';
import path from 'path';
import { mkdirSync, statSync } from 'fs';
import { SunoSession } from '../src/suno/session.js';

const CLIP_ID = 'f287d2d1-8e87-4e7f-845f-659a06b4bb32';
const OUTPUT_DIR = path.resolve('media/songs/2026-02-28');

async function main() {
  mkdirSync(OUTPUT_DIR, { recursive: true });

  console.log('Initializing Suno session...');
  const session = new SunoSession();
  await session.initialize(false, 0);

  const page = await session.newPage();

  // Intercept network to find audio URLs
  const audioUrls: string[] = [];
  page.on('response', (resp) => {
    const url = resp.url();
    if (url.includes(CLIP_ID) && (url.includes('.mp3') || url.includes('.m4a') || url.includes('audio'))) {
      audioUrls.push(url);
    }
    // Also catch CDN audio
    if (url.includes('cdn') && url.includes(CLIP_ID)) {
      audioUrls.push(url);
    }
  });

  // Navigate to song page
  const songUrl = `https://suno.com/song/${CLIP_ID}`;
  console.log(`\nNavigating to: ${songUrl}`);
  await page.goto(songUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.waitForTimeout(5000);

  // Screenshot
  await page.screenshot({ path: path.join(OUTPUT_DIR, 'song-page.png') });
  console.log('Screenshot saved');

  // Find audio sources in DOM
  console.log('\n=== Audio elements ===');
  const audioSrcs = await page.evaluate(() => {
    const doc = (globalThis as any).document;
    const results: string[] = [];
    const audios = doc.querySelectorAll('audio');
    for (const a of audios) {
      if (a.src) results.push(a.src);
      const sources = a.querySelectorAll('source');
      for (const s of sources) {
        if (s.src) results.push(s.src);
      }
    }
    // Also check video elements (Suno sometimes uses video for audio)
    const videos = doc.querySelectorAll('video');
    for (const v of videos) {
      if (v.src) results.push(v.src);
    }
    return results;
  });

  for (const src of audioSrcs) {
    console.log(`  [DOM] ${src}`);
  }

  console.log('\n=== Intercepted network audio URLs ===');
  for (const url of audioUrls) {
    console.log(`  [NET] ${url}`);
  }

  // Click play to trigger audio load
  console.log('\nClicking play button...');
  try {
    const playBtn = page.locator('[aria-label*="Play"], button:has(svg path[d*="M6 18.705"])').first();
    if (await playBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await playBtn.click();
      await page.waitForTimeout(3000);

      // Check again after play
      const newAudioSrcs = await page.evaluate(() => {
        const doc = (globalThis as any).document;
        const results: string[] = [];
        const audios = doc.querySelectorAll('audio');
        for (const a of audios) {
          if (a.src) results.push(a.src);
        }
        return results;
      });

      console.log('\n=== Audio after play ===');
      for (const src of newAudioSrcs) {
        console.log(`  [DOM] ${src}`);
      }

      console.log('\n=== Intercepted after play ===');
      for (const url of audioUrls) {
        console.log(`  [NET] ${url}`);
      }
    }
  } catch {
    console.log('  Play button not found');
  }

  // Try downloading best URL found
  const allUrls = [...new Set([...audioSrcs, ...audioUrls])];
  if (allUrls.length > 0) {
    console.log(`\nBest URL found: ${allUrls[0]}`);
    const outputPath = path.join(OUTPUT_DIR, '001-thunder-over-persian-sand.mp3');

    // Download using page.request (authenticated)
    const resp = await page.request.get(allUrls[0]);
    const buffer = await resp.body();
    const { writeFileSync } = await import('fs');
    writeFileSync(outputPath, buffer);

    const size = statSync(outputPath).size;
    console.log(`Downloaded: ${outputPath} (${(size / 1024).toFixed(0)} KB)`);
  } else {
    console.log('\nNo audio URL found!');
  }

  await page.close();
  await session.destroy();
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
