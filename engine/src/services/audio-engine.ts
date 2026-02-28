import { spawn, type ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import { existsSync } from 'fs';
import { logger } from '../utils/logger.js';
import { Scheduler, type ScheduledItem } from './scheduler.js';
import type { Server as SocketIOServer } from 'socket.io';

export class AudioEngine extends EventEmitter {
  private currentProcess: ChildProcess | null = null;
  private isRunning = false;
  private isPaused = false;
  private currentItem: ScheduledItem | null = null;
  private playStartTime: Date | null = null;

  constructor(
    private scheduler: Scheduler,
    private io: SocketIOServer,
    private mediaDir: string,
  ) {
    super();
  }

  async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;
    this.isPaused = false;
    logger.info('Audio engine started');
    this.playNext();
  }

  async stop(): Promise<void> {
    this.isRunning = false;
    this.isPaused = false;
    this.killCurrentProcess();
    this.currentItem = null;
    this.playStartTime = null;
    this.io.emit('now-playing:changed', { current: null, previous: null, next: null });
    logger.info('Audio engine stopped');
  }

  async pause(): Promise<void> {
    if (this.isPaused) {
      this.isPaused = false;
      // Resume by sending SIGCONT
      this.currentProcess?.kill('SIGCONT');
      logger.info('Audio engine resumed');
    } else {
      this.isPaused = true;
      // Pause by sending SIGSTOP
      this.currentProcess?.kill('SIGSTOP');
      logger.info('Audio engine paused');
    }
  }

  isPlaying(): boolean {
    return this.isRunning && !this.isPaused && this.currentProcess !== null;
  }

  getCurrentItem(): ScheduledItem | null {
    return this.currentItem;
  }

  getProgress(): { elapsed: number; duration: number; progress: number } {
    if (!this.playStartTime || !this.currentItem) {
      return { elapsed: 0, duration: 0, progress: 0 };
    }
    const elapsed = (Date.now() - this.playStartTime.getTime()) / 1000;
    const duration = this.currentItem.duration;
    return {
      elapsed: Math.min(elapsed, duration),
      duration,
      progress: Math.min(elapsed / duration, 1),
    };
  }

  private async playNext(): Promise<void> {
    if (!this.isRunning) return;

    const item = this.scheduler.getNextItem();
    if (!item) {
      logger.warn('No content available. Waiting 10s...');
      this.io.emit('alert', { level: 'warning', message: 'No content available', code: 'QUEUE_EMPTY' });
      setTimeout(() => this.playNext(), 10_000);
      return;
    }

    const filePath = `${this.mediaDir}/${item.filePath}`;
    if (!existsSync(filePath)) {
      logger.error({ filePath, title: item.title }, 'Audio file not found, skipping');
      this.playNext();
      return;
    }

    // Log playback
    this.scheduler.logPlayback(item);
    this.currentItem = item;
    this.playStartTime = new Date();

    // Emit now playing
    this.io.emit('now-playing:changed', {
      current: {
        contentId: item.contentId,
        title: item.title,
        type: item.contentType,
        duration: item.duration,
        startedAt: this.playStartTime.toISOString(),
      },
    });

    logger.info({ title: item.title, type: item.contentType, source: item.source, duration: item.duration }, 'Now playing');

    // Start progress updates
    const progressInterval = setInterval(() => {
      if (!this.isRunning || this.isPaused) return;
      const progress = this.getProgress();
      this.io.emit('now-playing:update', {
        contentId: item.contentId,
        title: item.title,
        type: item.contentType,
        ...progress,
        startedAt: this.playStartTime?.toISOString(),
      });
    }, 1000);

    try {
      await this.playFile(filePath);
    } catch (err) {
      logger.error({ err, title: item.title }, 'Playback error');
    } finally {
      clearInterval(progressInterval);
      this.currentItem = null;
      this.playStartTime = null;
    }

    // Play next
    if (this.isRunning) {
      this.playNext();
    }
  }

  private playFile(filePath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      // Use afplay on macOS, ffplay elsewhere
      const isdarwin = process.platform === 'darwin';
      const cmd = isdarwin ? 'afplay' : 'ffplay';
      const args = isdarwin ? [filePath] : ['-nodisp', '-autoexit', '-loglevel', 'quiet', filePath];

      this.currentProcess = spawn(cmd, args, { stdio: 'ignore' });

      this.currentProcess.on('exit', (code) => {
        this.currentProcess = null;
        if (code === 0 || code === null) {
          resolve();
        } else if (code === 9 || code === 15) {
          // Killed by SIGKILL or SIGTERM - expected during stop
          resolve();
        } else {
          reject(new Error(`Player exited with code ${code}`));
        }
      });

      this.currentProcess.on('error', (err) => {
        this.currentProcess = null;
        reject(err);
      });
    });
  }

  private killCurrentProcess(): void {
    if (this.currentProcess) {
      this.currentProcess.kill('SIGTERM');
      this.currentProcess = null;
    }
  }
}
