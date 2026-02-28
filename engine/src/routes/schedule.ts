import type { FastifyInstance } from 'fastify';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { scheduleSlots, content } from '../db/schema.js';
import { eq, and, gte, lte, desc } from 'drizzle-orm';
import { logger } from '../utils/logger.js';

export function registerScheduleRoutes(fastify: FastifyInstance, db: BetterSQLite3Database<any>) {
  // List schedule slots (with optional time range)
  fastify.get<{
    Querystring: { from?: string; to?: string };
  }>('/api/v1/schedule', async (request) => {
    const conditions = [];
    if (request.query.from) {
      conditions.push(gte(scheduleSlots.startTime, new Date(request.query.from)));
    }
    if (request.query.to) {
      conditions.push(lte(scheduleSlots.startTime, new Date(request.query.to)));
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    return db.select().from(scheduleSlots)
      .where(where)
      .orderBy(scheduleSlots.startTime)
      .all();
  });

  // Create schedule slot
  fastify.post<{
    Body: {
      contentId?: string;
      contentType?: string;
      startTime: string;
      endTime?: string;
      isRecurring?: boolean;
      recurrenceRule?: string;
      priority?: number;
      label?: string;
      color?: string;
    };
  }>('/api/v1/schedule', async (request, reply) => {
    const { contentId, contentType, startTime, endTime, isRecurring, recurrenceRule, priority, label, color } = request.body;

    // If contentId provided, verify it exists and get duration for endTime
    let computedEndTime = endTime ? new Date(endTime) : undefined;
    if (contentId && !computedEndTime) {
      const item = db.select().from(content).where(eq(content.id, contentId)).get();
      if (item?.duration) {
        computedEndTime = new Date(new Date(startTime).getTime() + item.duration * 1000);
      }
    }

    const slot = db.insert(scheduleSlots).values({
      contentId,
      contentType: contentType as any,
      startTime: new Date(startTime),
      endTime: computedEndTime,
      isRecurring,
      recurrenceRule,
      priority,
      label,
      color,
    }).returning().get();

    logger.info({ slotId: slot.id, startTime, contentType }, 'Schedule slot created');
    return reply.status(201).send(slot);
  });

  // Update schedule slot (drag-drop, resize)
  fastify.put<{
    Params: { id: string };
    Body: { startTime?: string; endTime?: string; contentId?: string; label?: string; color?: string; priority?: number };
  }>('/api/v1/schedule/:id', async (request, reply) => {
    const existing = db.select().from(scheduleSlots).where(eq(scheduleSlots.id, request.params.id)).get();
    if (!existing) return reply.status(404).send({ error: 'Not found' });

    const updates: Record<string, any> = {};
    if (request.body.startTime) updates.startTime = new Date(request.body.startTime);
    if (request.body.endTime) updates.endTime = new Date(request.body.endTime);
    if (request.body.contentId !== undefined) updates.contentId = request.body.contentId;
    if (request.body.label !== undefined) updates.label = request.body.label;
    if (request.body.color !== undefined) updates.color = request.body.color;
    if (request.body.priority !== undefined) updates.priority = request.body.priority;

    db.update(scheduleSlots).set(updates).where(eq(scheduleSlots.id, request.params.id)).run();
    return db.select().from(scheduleSlots).where(eq(scheduleSlots.id, request.params.id)).get();
  });

  // Delete schedule slot
  fastify.delete<{ Params: { id: string } }>('/api/v1/schedule/:id', async (request, reply) => {
    const existing = db.select().from(scheduleSlots).where(eq(scheduleSlots.id, request.params.id)).get();
    if (!existing) return reply.status(404).send({ error: 'Not found' });

    db.delete(scheduleSlots).where(eq(scheduleSlots.id, request.params.id)).run();
    return { success: true };
  });

  // Preview resolved schedule for next 24h
  fastify.get('/api/v1/schedule/preview', async () => {
    const now = new Date();
    const next24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    const slots = db.select().from(scheduleSlots)
      .where(and(
        gte(scheduleSlots.startTime, now),
        lte(scheduleSlots.startTime, next24h),
      ))
      .orderBy(scheduleSlots.startTime)
      .all();

    return { from: now.toISOString(), to: next24h.toISOString(), slots };
  });
}
