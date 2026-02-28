import type { FastifyInstance } from 'fastify';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { rotationPattern } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { logger } from '../utils/logger.js';

export function registerRotationRoutes(fastify: FastifyInstance, db: BetterSQLite3Database<any>) {
  // Get current rotation pattern
  fastify.get('/api/v1/rotation', async () => {
    return db.select().from(rotationPattern)
      .where(eq(rotationPattern.patternGroupId, 'default'))
      .orderBy(rotationPattern.position)
      .all();
  });

  // Replace entire rotation pattern
  fastify.put<{
    Body: {
      pattern: Array<{
        contentType: string;
        contentId?: string;
        selectionStrategy?: string;
      }>;
    };
  }>('/api/v1/rotation', async (request) => {
    // Delete existing default pattern
    db.delete(rotationPattern)
      .where(eq(rotationPattern.patternGroupId, 'default'))
      .run();

    // Insert new pattern
    for (let i = 0; i < request.body.pattern.length; i++) {
      const step = request.body.pattern[i];
      db.insert(rotationPattern).values({
        position: i,
        contentType: step.contentType as any,
        contentId: step.contentId,
        selectionStrategy: (step.selectionStrategy as any) || 'least_recently_played',
        patternGroupId: 'default',
      }).run();
    }

    logger.info({ stepCount: request.body.pattern.length }, 'Rotation pattern updated');

    return db.select().from(rotationPattern)
      .where(eq(rotationPattern.patternGroupId, 'default'))
      .orderBy(rotationPattern.position)
      .all();
  });
}
