import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import { logger } from '../utils/logger.js';
import { withRetry } from '../utils/retry.js';

const DEFAULT_VOICE = 'en-US-GuyNeural';
const MIN_OUTPUT_SIZE_BYTES = 1024; // 1 KB minimum for a valid audio file

/**
 * Text-to-speech service using the edge-tts CLI tool.
 *
 * Installation: pip install edge-tts  (provides `edge-tts` binary)
 * If the CLI is not available, this service will throw with a clear error.
 */
export class TtsService {
  private readonly voice: string;
  private edgeTtsPath: string | null = null;

  constructor(voice: string = DEFAULT_VOICE) {
    this.voice = voice;
  }

  /**
   * Generate speech audio from text, writing to outputPath.
   * Validates that the output file meets the minimum size requirement.
   */
  async generateSpeech(
    text: string,
    outputPath: string,
    voice: string = this.voice,
  ): Promise<void> {
    const resolvedPath = path.resolve(outputPath);

    // Ensure output directory exists
    await fs.mkdir(path.dirname(resolvedPath), { recursive: true });

    logger.info(
      { outputPath: resolvedPath, voice, textLength: text.length },
      'Generating TTS speech',
    );

    await withRetry(
      () => this.runEdgeTts(text, resolvedPath, voice),
      { maxAttempts: 3, baseDelay: 1000, label: 'tts-generation' },
    );

    // Validate output
    await this.validateOutput(resolvedPath);

    logger.info({ outputPath: resolvedPath }, 'TTS speech generated successfully');
  }

  private async runEdgeTts(text: string, outputPath: string, voice: string): Promise<void> {
    const cliPath = await this.resolveEdgeTtsCli();

    return new Promise<void>((resolve, reject) => {
      const args = [
        '--voice', voice,
        '--text', text,
        '--write-media', outputPath,
      ];

      logger.debug({ cli: cliPath, args }, 'Spawning edge-tts');

      const proc = spawn(cliPath, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      const stderr: string[] = [];
      proc.stderr.on('data', (chunk: Buffer) => {
        stderr.push(chunk.toString());
      });

      proc.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          const errMsg = stderr.join('').trim();
          reject(new Error(`edge-tts exited with code ${code}: ${errMsg}`));
        }
      });

      proc.on('error', (err) => {
        reject(new Error(`Failed to spawn edge-tts: ${err.message}. Install with: pip install edge-tts`));
      });
    });
  }

  private async validateOutput(filePath: string): Promise<void> {
    let stat;
    try {
      stat = await fs.stat(filePath);
    } catch {
      throw new Error(`TTS output file not found at ${filePath}`);
    }

    if (stat.size < MIN_OUTPUT_SIZE_BYTES) {
      throw new Error(
        `TTS output file too small: ${stat.size} bytes (minimum ${MIN_OUTPUT_SIZE_BYTES}). ` +
        'The generated audio may be empty or corrupt.',
      );
    }
  }

  /** Resolve the edge-tts CLI path, checking common locations. */
  private async resolveEdgeTtsCli(): Promise<string> {
    if (this.edgeTtsPath) return this.edgeTtsPath;

    const candidates = [
      'edge-tts',           // On $PATH (pip install edge-tts)
      '/usr/local/bin/edge-tts',
      '/usr/bin/edge-tts',
      `${process.env.HOME}/.local/bin/edge-tts`,
    ];

    for (const candidate of candidates) {
      const found = await this.which(candidate);
      if (found) {
        this.edgeTtsPath = candidate;
        logger.debug({ path: candidate }, 'Found edge-tts CLI');
        return candidate;
      }
    }

    throw new Error(
      'edge-tts CLI not found. Install it with: pip install edge-tts\n' +
      'Then ensure it is on your PATH.',
    );
  }

  private async which(command: string): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const isAbsolute = command.startsWith('/');
      if (isAbsolute) {
        fs.access(command).then(() => resolve(true)).catch(() => resolve(false));
        return;
      }

      const proc = spawn('which', [command], { stdio: 'ignore' });
      proc.on('close', (code) => resolve(code === 0));
      proc.on('error', () => resolve(false));
    });
  }

  /** List available voices for discovery/configuration. */
  async listVoices(): Promise<string[]> {
    const cliPath = await this.resolveEdgeTtsCli();
    return new Promise<string[]>((resolve, reject) => {
      const proc = spawn(cliPath, ['--list-voices'], { stdio: ['ignore', 'pipe', 'pipe'] });
      const stdout: string[] = [];
      proc.stdout.on('data', (chunk: Buffer) => stdout.push(chunk.toString()));
      proc.on('close', (code) => {
        if (code === 0) {
          const voices = stdout.join('').split('\n').filter(l => l.includes('Name:')).map(l => {
            const match = l.match(/Name:\s*(\S+)/);
            return match ? match[1] : '';
          }).filter(Boolean);
          resolve(voices);
        } else {
          reject(new Error(`edge-tts --list-voices failed with code ${code}`));
        }
      });
      proc.on('error', reject);
    });
  }
}
