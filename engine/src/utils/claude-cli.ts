import { spawn } from 'child_process';
import { writeFile, unlink } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { nanoid } from 'nanoid';
import { logger } from './logger.js';

const CLI_TIMEOUT_MS = 180_000; // 3 minutes per call

export interface ClaudeCliOptions {
  /** System prompt for Claude */
  systemPrompt?: string;
  /** Timeout in ms (default 180s) */
  timeout?: number;
}

/**
 * Call `claude` CLI as a subprocess.
 * Uses the user's existing Claude Code authentication (Max subscription).
 * Strips Claude env vars to avoid nested session detection.
 */
export async function callClaudeCli(
  userPrompt: string,
  options: ClaudeCliOptions = {},
): Promise<string> {
  const { systemPrompt, timeout = CLI_TIMEOUT_MS } = options;

  // Write prompt to temp file to avoid shell escaping issues
  const tmpFile = path.join(tmpdir(), `radiowar-${nanoid(8)}.txt`);

  // Combine system + user prompt (claude CLI doesn't have --system-prompt in print mode)
  const fullPrompt = systemPrompt
    ? `${systemPrompt}\n\n---\n\nUSER REQUEST:\n${userPrompt}`
    : userPrompt;

  await writeFile(tmpFile, fullPrompt, 'utf-8');

  try {
    return await runClaudeProcess(tmpFile, timeout);
  } finally {
    await unlink(tmpFile).catch(() => undefined);
  }
}

function runClaudeProcess(promptFile: string, timeout: number): Promise<string> {
  return new Promise((resolve, reject) => {
    // Build a clean env without ANY Claude Code session markers
    const cleanEnv: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (value === undefined) continue;
      // Skip all Claude Code session env vars
      if (key === 'CLAUDECODE') continue;
      if (key === 'CLAUDE_CODE_ENTRYPOINT') continue;
      if (key === 'CLAUDE_CODE_SESSION_ACCESS_TOKEN') continue;
      if (key === 'CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS') continue;
      if (key.startsWith('CLAUDE_CODE_')) continue;
      cleanEnv[key] = value;
    }

    // Use cat to read the prompt file and pipe it as argument
    const cmd = `cat '${promptFile}' | claude -p - --output-format text --max-turns 1`;

    const proc = spawn('bash', ['-c', cmd], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: cleanEnv,
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    proc.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    const timer = setTimeout(() => {
      proc.kill('SIGTERM');
      reject(new Error(`Claude CLI timed out after ${timeout / 1000}s`));
    }, timeout);

    proc.on('close', (code) => {
      clearTimeout(timer);

      if (code !== 0) {
        logger.error({ code, stderr: stderr.slice(0, 500) }, 'Claude CLI error');
        reject(new Error(`Claude CLI exited with code ${code}: ${stderr.slice(0, 300)}`));
        return;
      }

      const response = stdout.trim();
      if (!response) {
        reject(new Error('Claude CLI returned empty response'));
        return;
      }

      resolve(response);
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(new Error(`Failed to spawn claude CLI: ${err.message}`));
    });
  });
}
