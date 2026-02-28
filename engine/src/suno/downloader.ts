import { promises as fs } from 'fs';
import path from 'path';
import { logger } from '../utils/logger.js';
import { withRetry } from '../utils/retry.js';

const MIN_FILE_SIZE_BYTES = 50 * 1024; // 50 KB

export class DownloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DownloadError';
  }
}

/**
 * Download an audio file from a URL to the local filesystem.
 * Validates minimum file size of 50 KB after download.
 */
export async function downloadAudio(
  audioUrl: string,
  outputPath: string,
): Promise<void> {
  const resolvedPath = path.resolve(outputPath);
  await fs.mkdir(path.dirname(resolvedPath), { recursive: true });

  logger.info({ url: audioUrl, outputPath: resolvedPath }, 'Downloading audio');

  await withRetry(
    () => fetchToFile(audioUrl, resolvedPath),
    { maxAttempts: 3, baseDelay: 2000, label: 'audio-download' },
  );

  await validateMinSize(resolvedPath);

  const stat = await fs.stat(resolvedPath);
  logger.info({ outputPath: resolvedPath, bytes: stat.size }, 'Audio downloaded successfully');
}

async function fetchToFile(url: string, outputPath: string): Promise<void> {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      'Accept': 'audio/mpeg, audio/*, */*',
      'Referer': 'https://suno.com/',
    },
  });

  const status = response.status;
  const contentType = response.headers.get('content-type') ?? '';
  const contentLength = response.headers.get('content-length') ?? 'unknown';
  logger.debug({ url, status, contentType, contentLength }, 'Download response received');

  if (!response.ok) {
    throw new DownloadError(
      `HTTP ${response.status} ${response.statusText} when downloading ${url}`,
    );
  }

  if (contentType && !contentType.includes('audio') && !contentType.includes('octet-stream') && !contentType.includes('video')) {
    logger.warn({ contentType, url }, 'Unexpected content-type for audio download');
  }

  if (!response.body) {
    throw new DownloadError('Response body is null');
  }

  const buffer = await response.arrayBuffer();
  logger.debug({ url, bytes: buffer.byteLength }, 'Download buffer received');
  await fs.writeFile(outputPath, Buffer.from(buffer));
}

async function validateMinSize(filePath: string): Promise<void> {
  let stat;
  try {
    stat = await fs.stat(filePath);
  } catch {
    throw new DownloadError(`Downloaded file not found at ${filePath}`);
  }

  if (stat.size < MIN_FILE_SIZE_BYTES) {
    await fs.unlink(filePath).catch(() => undefined); // clean up bad file
    throw new DownloadError(
      `Downloaded audio file is too small: ${stat.size} bytes (minimum ${MIN_FILE_SIZE_BYTES} bytes). ` +
      'The file may be empty or an error page.',
    );
  }
}
