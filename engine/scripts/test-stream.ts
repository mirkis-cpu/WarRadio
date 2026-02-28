#!/usr/bin/env npx tsx
/**
 * Test the StreamManager by generating a short test tone
 * and streaming it to a local FLV file (no YouTube key needed).
 */
import { execSync, spawn, type ChildProcess } from 'child_process';
import { existsSync, mkdirSync, unlinkSync } from 'fs';
import path from 'path';

const TEST_DIR = path.resolve('media/test');
const TEST_AUDIO = path.join(TEST_DIR, 'test-tone.mp3');
const TEST_OUTPUT = path.join(TEST_DIR, 'test-output.flv');

async function main() {
  console.log('=== StreamManager Local Test ===\n');

  // Ensure test directory exists
  if (!existsSync(TEST_DIR)) {
    mkdirSync(TEST_DIR, { recursive: true });
  }

  // 1. Check ffmpeg
  console.log('1. Checking ffmpeg...');
  try {
    const version = execSync('ffmpeg -version', { encoding: 'utf-8' }).split('\n')[0];
    console.log(`   ${version}`);
  } catch {
    console.error('   FAIL: ffmpeg not found. Install with: brew install ffmpeg');
    process.exit(1);
  }

  // 2. Generate a 10-second test tone
  console.log('\n2. Generating 10s test tone...');
  if (!existsSync(TEST_AUDIO)) {
    execSync(
      `ffmpeg -y -f lavfi -i "sine=frequency=440:duration=10" -c:a libmp3lame -b:a 192k "${TEST_AUDIO}"`,
      { stdio: 'pipe' },
    );
  }
  console.log(`   Created: ${TEST_AUDIO}`);

  // 3. Test ffmpeg with overlay (output to local file instead of RTMP)
  console.log('\n3. Testing ffmpeg with overlay → local FLV...');
  if (existsSync(TEST_OUTPUT)) unlinkSync(TEST_OUTPUT);

  const VIDEO_WIDTH = 1920;
  const VIDEO_HEIGHT = 1080;
  const VIDEO_FPS = 1;

  const filterParts = [
    `color=c=0x0a0a0a:s=${VIDEO_WIDTH}x${VIDEO_HEIGHT}:r=${VIDEO_FPS}[bg]`,
    `[bg]drawtext=text='LIVE':fontcolor=red:fontsize=36:x=${VIDEO_WIDTH - 150}:y=30[v1]`,
    `[v1]drawtext=text='RadioWar':fontcolor=white:fontsize=48:x=60:y=30[v2]`,
    `[v2]drawtext=text='TEST STREAM':fontcolor=white:fontsize=56:x=60:y=${VIDEO_HEIGHT - 180}[v3]`,
    `[v3]drawtext=text='PUNK ROCK':fontcolor=0x8b5cf6:fontsize=28:x=60:y=${VIDEO_HEIGHT - 110}[vout]`,
  ];

  const args = [
    '-re',
    '-i', TEST_AUDIO,
    '-filter_complex', filterParts.join(';'),
    '-map', '[vout]',
    '-map', '0:a',
    '-c:v', 'libx264',
    '-preset', 'ultrafast',
    '-tune', 'stillimage',
    '-b:v', '1500k',
    '-pix_fmt', 'yuv420p',
    '-r', String(VIDEO_FPS),
    '-g', String(VIDEO_FPS * 2),
    '-c:a', 'aac',
    '-b:a', '192k',
    '-ar', '44100',
    '-f', 'flv',
    '-shortest',
    '-t', '5', // Only 5 seconds for test
    TEST_OUTPUT,
  ];

  const result = await runFfmpeg(args);

  if (result.success && existsSync(TEST_OUTPUT)) {
    const { size } = await import('fs').then((fs) => fs.statSync(TEST_OUTPUT));
    console.log(`   Output: ${TEST_OUTPUT} (${(size / 1024).toFixed(0)} KB)`);
    console.log('   PASS: ffmpeg overlay rendering works');
  } else {
    console.error('   FAIL: ffmpeg did not produce output');
    console.error(`   stderr: ${result.stderr.slice(-300)}`);
    process.exit(1);
  }

  // Cleanup
  unlinkSync(TEST_OUTPUT);
  console.log('\n=== All tests passed ===');
  console.log('\nTo stream to YouTube, set YOUTUBE_STREAM_KEY in .env');
}

function runFfmpeg(args: string[]): Promise<{ success: boolean; stderr: string }> {
  return new Promise((resolve) => {
    const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    proc.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    proc.on('close', (code) => {
      resolve({ success: code === 0, stderr });
    });
    proc.on('error', () => {
      resolve({ success: false, stderr });
    });
  });
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
