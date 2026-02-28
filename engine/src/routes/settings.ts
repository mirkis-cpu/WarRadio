import type { FastifyInstance } from 'fastify';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { settings } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { logger } from '../utils/logger.js';

// Default settings
const DEFAULTS: Record<string, unknown> = {
  language: 'en',
  pollIntervalMs: 300000, // 5 minutes
  minBufferSize: 3,
  targetBufferSize: 6,
  ttsProvider: 'edge-tts',
  ttsVoice: 'en-US-GuyNeural',
  feeds: [
    { name: 'BBC World', url: 'https://feeds.bbci.co.uk/news/world/rss.xml', enabled: true },
    { name: 'Al Jazeera', url: 'https://www.aljazeera.com/xml/rss/all.xml', enabled: true },
    { name: 'CNN World', url: 'http://rss.cnn.com/rss/cnn_world.rss', enabled: true },
    { name: 'The Guardian', url: 'https://www.theguardian.com/world/rss', enabled: true },
    { name: 'Deutsche Welle', url: 'https://rss.dw.com/rdf/rss-en-all', enabled: true },
    { name: 'Google News War', url: 'https://news.google.com/rss/search?q=war+conflict+military&hl=en-US&gl=US&ceid=US:en', enabled: true },
  ],
  genres: [
    { name: 'punk-rock', weight: 5, enabled: true },
    { name: 'rap', weight: 5, enabled: true },
    { name: 'folk', weight: 5, enabled: true },
    { name: 'electronic', weight: 5, enabled: true },
    { name: 'blues', weight: 3, enabled: true },
    { name: 'country', weight: 3, enabled: true },
  ],
  warKeywords: [
    'war', 'conflict', 'military', 'attack', 'bomb', 'troops', 'invasion',
    'missile', 'airstrike', 'combat', 'battle', 'siege', 'ceasefire',
    'casualties', 'artillery', 'drone strike', 'offensive', 'defense',
    'frontline', 'occupation', 'insurgent', 'rebel', 'armed forces',
  ],
  youtubeChannel: 'https://www.youtube.com/@WarNewsRadio-q4k',
};

export function registerSettingsRoutes(fastify: FastifyInstance, db: BetterSQLite3Database<any>) {
  // Get all settings (merged with defaults)
  fastify.get('/api/v1/settings', async () => {
    const stored = db.select().from(settings).all();
    const result = { ...DEFAULTS };
    for (const row of stored) {
      result[row.key] = row.value;
    }
    return result;
  });

  // Update settings (partial)
  fastify.patch<{ Body: Record<string, unknown> }>('/api/v1/settings', async (request) => {
    const updates = request.body;

    for (const [key, value] of Object.entries(updates)) {
      const existing = db.select().from(settings).where(eq(settings.key, key)).get();
      if (existing) {
        db.update(settings).set({ value: value as any, updatedAt: new Date() }).where(eq(settings.key, key)).run();
      } else {
        db.insert(settings).values({ key, value: value as any }).run();
      }
    }

    logger.info({ keys: Object.keys(updates) }, 'Settings updated');

    // Return merged settings
    const stored = db.select().from(settings).all();
    const result = { ...DEFAULTS };
    for (const row of stored) {
      result[row.key] = row.value;
    }
    return result;
  });
}
