import { spawn, type ChildProcess } from 'child_process';
import { existsSync, readdirSync } from 'fs';
import path from 'path';
import { EventEmitter } from 'events';
import { logger } from '../utils/logger.js';
import { sleep } from '../utils/sleep.js';
import { getConfig } from '../config.js';
import type { AudioBufferEntry } from './pipeline.js';

const YOUTUBE_RTMP_BASE = 'rtmp://a.rtmp.youtube.com/live2';

// Video settings for YouTube Live
const VIDEO_WIDTH = 1920;
const VIDEO_HEIGHT = 1080;
const VIDEO_FPS = 1; // Low FPS since it's mostly static
const VIDEO_BITRATE = '1500k';
const AUDIO_BITRATE = '192k';
const AUDIO_SAMPLE_RATE = 44100;

export interface StreamConfig {
  rtmpUrl: string;
  streamKey: string;
  backgroundImage?: string; // Path to background image (1920x1080)
}

export interface StreamStatus {
  isStreaming: boolean;
  startedAt: Date | null;
  currentTrack: string | null;
  tracksPlayed: number;
  uptimeSeconds: number;
  errors: number;
}

/**
 * RTMP Stream Manager.
 * Takes audio files from the pipeline buffer, overlays track info
 * on a background image, and streams to YouTube Live via ffmpeg.
 */
export class StreamManager extends EventEmitter {
  private ffmpegProcess: ChildProcess | null = null;
  private isStreaming = false;
  private startedAt: Date | null = null;
  private currentTrack: string | null = null;
  private tracksPlayed = 0;
  private errorCount = 0;

  private readonly config: StreamConfig;

  constructor(config: StreamConfig) {
    super();
    this.config = config;
  }

  getStatus(): StreamStatus {
    return {
      isStreaming: this.isStreaming,
      startedAt: this.startedAt,
      currentTrack: this.currentTrack,
      tracksPlayed: this.tracksPlayed,
      uptimeSeconds: this.startedAt
        ? Math.round((Date.now() - this.startedAt.getTime()) / 1000)
        : 0,
      errors: this.errorCount,
    };
  }

  /**
   * Start streaming. Takes a function that provides the next audio file.
   * Runs continuously until stop() is called.
   */
  async startStreaming(
    getNextTrack: () => AudioBufferEntry | null,
  ): Promise<void> {
    if (this.isStreaming) {
      logger.warn('Stream already running');
      return;
    }

    if (!this.config.streamKey) {
      throw new Error('YOUTUBE_STREAM_KEY not configured. Set it in .env file.');
    }

    this.isStreaming = true;
    this.startedAt = new Date();
    this.tracksPlayed = 0;
    this.errorCount = 0;

    logger.info(
      { rtmpUrl: this.config.rtmpUrl },
      'Starting YouTube Live stream',
    );

    // Stream loop: play tracks one after another
    while (this.isStreaming) {
      const track = getNextTrack();

      if (!track) {
        logger.warn('No tracks in buffer — waiting 10s');
        this.currentTrack = null;
        await sleep(10_000);
        continue;
      }

      if (!existsSync(track.filePath)) {
        logger.error({ filePath: track.filePath }, 'Track file not found, skipping');
        continue;
      }

      this.currentTrack = track.title;
      this.tracksPlayed++;

      logger.info(
        { title: track.title, type: track.type, track: this.tracksPlayed },
        'Streaming track',
      );

      try {
        await this.streamSingleTrack(track);
      } catch (err) {
        this.errorCount++;
        logger.error({ err, title: track.title }, 'Track streaming error');

        // Wait before retrying to avoid rapid failure loop
        if (this.isStreaming) {
          await sleep(5_000);
        }
      }
    }

    this.currentTrack = null;
    logger.info('Stream stopped');
  }

  stop(): void {
    this.isStreaming = false;
    this.killFfmpeg();
    logger.info('Stream manager stopped');
  }

  // ---------------------------------------------------------------------------
  // Private: ffmpeg streaming
  // ---------------------------------------------------------------------------

  /**
   * Stream a single audio track to YouTube with a visual overlay.
   * Returns when the track finishes playing.
   */
  private streamSingleTrack(track: AudioBufferEntry): Promise<void> {
    return new Promise((resolve, reject) => {
      const rtmpTarget = `${this.config.rtmpUrl}/${this.config.streamKey}`;
      const fontPath = getConfig().FONT_PATH;

      // Build the overlay text
      const genre = (track.metadata?.genre as string) || track.type;
      const headline = (track.metadata?.storyHeadline as string) || '';
      const nowPlayingText = this.escapeFFmpegText(track.title);
      const genreText = this.escapeFFmpegText(genre.toUpperCase());
      const headlineText = headline
        ? this.escapeFFmpegText(headline)
        : '';
      const timeText = '%{localtime\\:%H\\\\:%M}';

      // Build filter: background + text overlays
      const bgImage = this.config.backgroundImage && existsSync(this.config.backgroundImage)
        ? this.config.backgroundImage
        : null;

      const filterParts: string[] = [];

      if (bgImage) {
        // Use provided background image
        filterParts.push(
          `[1:v]scale=${VIDEO_WIDTH}:${VIDEO_HEIGHT}[bg]`,
        );
      } else {
        // Generate solid dark background
        filterParts.push(
          `color=c=0x0a0a0a:s=${VIDEO_WIDTH}x${VIDEO_HEIGHT}:r=${VIDEO_FPS}[bg]`,
        );
      }

      // LIVE badge (top-right)
      filterParts.push(
        `[bg]drawtext=text='LIVE':fontcolor=red:fontsize=36:x=${VIDEO_WIDTH - 150}:y=30:fontfile=${fontPath}[v1]`,
      );

      // Station name (top-left)
      filterParts.push(
        `[v1]drawtext=text='RadioWar':fontcolor=white:fontsize=48:x=60:y=30[v2]`,
      );

      // Clock (top-right, below LIVE)
      filterParts.push(
        `[v2]drawtext=text='${timeText}':fontcolor=white@0.7:fontsize=28:x=${VIDEO_WIDTH - 160}:y=75[v3]`,
      );

      // Now Playing label
      filterParts.push(
        `[v3]drawtext=text='NOW PLAYING':fontcolor=0xaaaaaa:fontsize=24:x=60:y=${VIDEO_HEIGHT - 220}[v4]`,
      );

      // Song title (big)
      filterParts.push(
        `[v4]drawtext=text='${nowPlayingText}':fontcolor=white:fontsize=56:x=60:y=${VIDEO_HEIGHT - 180}[v5]`,
      );

      // Genre badge
      filterParts.push(
        `[v5]drawtext=text='${genreText}':fontcolor=0x8b5cf6:fontsize=28:x=60:y=${VIDEO_HEIGHT - 110}[v6]`,
      );

      // Headline ticker (if available)
      if (headlineText) {
        filterParts.push(
          `[v6]drawtext=text='${headlineText}':fontcolor=0xfbbf24:fontsize=22:x=60:y=${VIDEO_HEIGHT - 70}[vout]`,
        );
      } else {
        filterParts.push(`[v6]copy[vout]`);
      }

      const filterComplex = filterParts.join(';');

      // Build ffmpeg command
      const args: string[] = [
        '-re', // Read input at native frame rate

        // Audio input
        '-i', track.filePath,
      ];

      if (bgImage) {
        // Background image input
        args.push('-loop', '1', '-i', bgImage);
      }

      args.push(
        // Filter
        '-filter_complex', filterComplex,
        '-map', '[vout]',
        '-map', '0:a',

        // Video encoding
        '-c:v', 'libx264',
        '-preset', 'ultrafast',
        '-tune', 'stillimage',
        '-b:v', VIDEO_BITRATE,
        '-pix_fmt', 'yuv420p',
        '-r', String(VIDEO_FPS),
        '-g', String(VIDEO_FPS * 2), // Keyframe interval

        // Audio encoding
        '-c:a', 'aac',
        '-b:a', AUDIO_BITRATE,
        '-ar', String(AUDIO_SAMPLE_RATE),

        // Output
        '-f', 'flv',
        '-shortest', // Stop when audio ends
        rtmpTarget,
      );

      this.ffmpegProcess = spawn('ffmpeg', args, {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stderr = '';

      this.ffmpegProcess.stderr?.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
        // Only log errors, not progress
        const text = chunk.toString();
        if (text.includes('Error') || text.includes('error')) {
          logger.error({ ffmpegError: text.trim() }, 'ffmpeg error');
        }
      });

      this.ffmpegProcess.on('close', (code) => {
        this.ffmpegProcess = null;

        if (code === 0 || code === null || code === 255) {
          resolve();
        } else if (code === 9 || code === 15) {
          // Killed by signal — expected on stop
          resolve();
        } else {
          reject(new Error(`ffmpeg exited with code ${code}`));
        }
      });

      this.ffmpegProcess.on('error', (err) => {
        this.ffmpegProcess = null;
        reject(err);
      });
    });
  }

  private killFfmpeg(): void {
    if (this.ffmpegProcess) {
      this.ffmpegProcess.kill('SIGTERM');
      this.ffmpegProcess = null;
    }
  }

  /** Escape special characters for ffmpeg drawtext filter */
  private escapeFFmpegText(text: string): string {
    return text
      .replace(/\\/g, '\\\\\\\\')
      .replace(/'/g, "\\'")
      .replace(/:/g, '\\:')
      .replace(/%/g, '%%')
      .replace(/\[/g, '\\[')
      .replace(/\]/g, '\\]');
  }
}
