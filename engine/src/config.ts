import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  ANTHROPIC_API_KEY: z.string().optional(),
  ENGINE_PORT: z.coerce.number().default(3001),
  DATABASE_PATH: z.string().default('./data/radiowar.db'),
  MEDIA_DIR: z.string().default('./media'),
  SESSION_PATH: z.string().default('./data/sessions/storageState.json'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  SUNO_HEADLESS: z.coerce.boolean().default(true),
  SUNO_CAPTCHA_MODE: z.enum(['manual', '2captcha', 'skip']).default('manual'),
  CAPTCHA_2_API_KEY: z.string().optional(),
  YOUTUBE_RTMP_URL: z.string().default('rtmp://a.rtmp.youtube.com/live2'),
  YOUTUBE_STREAM_KEY: z.string().optional(),
});

export type EnvConfig = z.infer<typeof envSchema>;

let _config: EnvConfig | null = null;

export function getConfig(): EnvConfig {
  if (!_config) {
    const result = envSchema.safeParse(process.env);
    if (!result.success) {
      console.error('Invalid environment configuration:');
      for (const issue of result.error.issues) {
        console.error(`  ${issue.path.join('.')}: ${issue.message}`);
      }
      process.exit(1);
    }
    _config = result.data;
  }
  return _config;
}
