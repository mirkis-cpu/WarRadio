import { sleep } from './sleep.js';
import { logger } from './logger.js';

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: {
    maxAttempts?: number;
    baseDelay?: number;
    maxDelay?: number;
    label?: string;
  } = {},
): Promise<T> {
  const { maxAttempts = 3, baseDelay = 1000, maxDelay = 30000, label = 'operation' } = options;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt === maxAttempts) throw error;
      const delay = Math.min(baseDelay * 2 ** (attempt - 1), maxDelay);
      logger.warn({ attempt, maxAttempts, delay, label, error: String(error) }, `Retrying ${label}`);
      await sleep(delay);
    }
  }
  throw new Error('Unreachable');
}
