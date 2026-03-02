import Anthropic from '@anthropic-ai/sdk';
import { getConfig } from '../config.js';
import { logger } from './logger.js';

const DEFAULT_TIMEOUT_MS = 180_000; // 3 minutes per call
const DEFAULT_MAX_TOKENS = 8192;

export interface ClaudeCliOptions {
  /** System prompt for Claude */
  systemPrompt?: string;
  /** Timeout in ms (default 180s) */
  timeout?: number;
}

let _client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!_client) {
    const config = getConfig();
    if (!config.ANTHROPIC_API_KEY) {
      throw new Error(
        'ANTHROPIC_API_KEY not configured. Set it in .env or .env.production',
      );
    }
    _client = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });
  }
  return _client;
}

/**
 * Call Claude via Anthropic SDK.
 * Drop-in replacement for the old CLI-based approach — same interface,
 * but uses the REST API directly (no OAuth tokens, no subprocess).
 */
export async function callClaudeCli(
  userPrompt: string,
  options: ClaudeCliOptions = {},
): Promise<string> {
  const { systemPrompt, timeout = DEFAULT_TIMEOUT_MS } = options;
  const config = getConfig();
  const model = config.AI_MODEL;

  logger.debug({ model, promptLength: userPrompt.length }, 'Calling Anthropic API');

  const client = getClient();

  const message = await client.messages.create(
    {
      model,
      max_tokens: DEFAULT_MAX_TOKENS,
      ...(systemPrompt ? { system: systemPrompt } : {}),
      messages: [{ role: 'user', content: userPrompt }],
    },
    { timeout },
  );

  const text = message.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('');

  if (!text) {
    throw new Error('Claude API returned empty response');
  }

  logger.debug(
    {
      model,
      inputTokens: message.usage.input_tokens,
      outputTokens: message.usage.output_tokens,
    },
    'Anthropic API response received',
  );

  return text;
}
