import { logger } from '../utils/logger.js';
import { sleep } from '../utils/sleep.js';
import { getConfig } from '../config.js';

const API_BASE = 'https://api.sunoapi.org';
const POLL_INTERVAL_MS = 10_000;
const GENERATION_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

export interface SunoApiInput {
  style: string;
  lyrics: string;
  title: string;
}

export interface SunoApiResult {
  clipId: string;
  audioUrl: string;
  title: string;
  duration: number;
}

export class SunoApiGenerationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SunoApiGenerationError';
  }
}

/**
 * Generate songs via sunoapi.org REST API.
 * Each call produces 2 songs. No browser, no captcha.
 */
export class SunoApiGenerator {
  private readonly apiKey: string;
  private readonly model: string;

  constructor() {
    const config = getConfig();
    if (!config.SUNO_API_KEY) {
      throw new Error('SUNO_API_KEY not configured. Get one at https://sunoapi.org/api-key');
    }
    this.apiKey = config.SUNO_API_KEY;
    this.model = config.SUNO_API_MODEL;
  }

  /**
   * Generate a song with custom lyrics and style.
   * Returns up to 2 results (API always generates a pair).
   */
  async generate(input: SunoApiInput): Promise<SunoApiResult[]> {
    logger.info({ title: input.title, model: this.model }, 'Starting Suno API generation');

    // Step 1: Submit generation request
    const taskId = await this.submitGeneration(input);
    logger.info({ taskId, title: input.title }, 'Generation task submitted');

    // Step 2: Poll for completion
    const results = await this.pollForCompletion(taskId);
    logger.info(
      { taskId, count: results.length, titles: results.map(r => r.title) },
      'Suno API generation complete',
    );

    return results;
  }

  /**
   * Check remaining credits on the account.
   */
  async getCredits(): Promise<number> {
    const res = await this.apiCall('GET', '/api/v1/generate/credit');
    return res.data?.credits ?? res.data?.remainingCredits ?? res.data ?? 0;
  }

  private async submitGeneration(input: SunoApiInput): Promise<string> {
    const body = {
      customMode: true,
      instrumental: false,
      style: input.style,
      title: input.title,
      prompt: input.lyrics,
      model: this.model,
      // Required by API — we poll via record-info instead of relying on callback
      callBackUrl: 'https://localhost/callback',
    };

    const res = await this.apiCall('POST', '/api/v1/generate', body);

    if (res.code !== 200 || !res.data?.taskId) {
      throw new SunoApiGenerationError(
        `API submission failed: code=${res.code} msg=${res.msg}`,
      );
    }

    return res.data.taskId;
  }

  private async pollForCompletion(taskId: string): Promise<SunoApiResult[]> {
    const deadline = Date.now() + GENERATION_TIMEOUT_MS;
    let attempt = 0;

    // Wait 30s before first poll (generation takes ~2 min)
    await sleep(30_000);

    while (Date.now() < deadline) {
      attempt++;

      const res = await this.apiCall(
        'GET',
        `/api/v1/generate/record-info?taskId=${taskId}`,
      );

      const status = res.data?.status;
      logger.info({ taskId, attempt, status }, 'Poll status');

      if (status === 'SUCCESS') {
        const sunoData = res.data?.response?.sunoData ?? res.data?.response?.data ?? [];
        return sunoData.map((item: any) => ({
          clipId: item.id,
          audioUrl: item.audioUrl ?? item.audio_url,
          title: item.title,
          duration: item.duration ?? 0,
        }));
      }

      if (
        status === 'CREATE_TASK_FAILED' ||
        status === 'GENERATE_AUDIO_FAILED' ||
        status === 'SENSITIVE_WORD_ERROR' ||
        status === 'FAILED'
      ) {
        throw new SunoApiGenerationError(
          `Generation failed: status=${status} msg=${res.data?.errorMessage ?? res.msg}`,
        );
      }

      // PENDING, TEXT_SUCCESS, FIRST_SUCCESS — keep polling
      await sleep(POLL_INTERVAL_MS);
    }

    throw new SunoApiGenerationError(
      `Generation timed out after ${GENERATION_TIMEOUT_MS / 1000}s for task ${taskId}`,
    );
  }

  private async apiCall(
    method: 'GET' | 'POST',
    path: string,
    body?: Record<string, unknown>,
  ): Promise<any> {
    const url = `${API_BASE}${path}`;
    const options: RequestInit = {
      method,
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
    };

    if (body) {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(url, options);

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new SunoApiGenerationError(
        `API HTTP error: ${response.status} ${response.statusText} — ${text.slice(0, 200)}`,
      );
    }

    return response.json();
  }
}
