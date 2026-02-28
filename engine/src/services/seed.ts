import { eq } from 'drizzle-orm';
import { rotationPattern } from '../db/schema.js';
import { logger } from '../utils/logger.js';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

export function seedDefaultRotation(db: BetterSQLite3Database<any>) {
  const existing = db.select().from(rotationPattern).all();
  if (existing.length > 0) return;

  // Default rotation: Song x3 → News → Song x2 → Ad → repeat
  const defaultPattern = [
    { position: 0, contentType: 'song' as const, selectionStrategy: 'least_recently_played' as const },
    { position: 1, contentType: 'song' as const, selectionStrategy: 'least_recently_played' as const },
    { position: 2, contentType: 'song' as const, selectionStrategy: 'least_recently_played' as const },
    { position: 3, contentType: 'news_block' as const, selectionStrategy: 'sequential' as const },
    { position: 4, contentType: 'song' as const, selectionStrategy: 'least_recently_played' as const },
    { position: 5, contentType: 'song' as const, selectionStrategy: 'least_recently_played' as const },
    { position: 6, contentType: 'ad' as const, selectionStrategy: 'random' as const },
  ];

  for (const step of defaultPattern) {
    db.insert(rotationPattern).values({
      ...step,
      patternGroupId: 'default',
    }).run();
  }

  logger.info('Default rotation pattern seeded: Song×3 → News → Song×2 → Ad');
}
