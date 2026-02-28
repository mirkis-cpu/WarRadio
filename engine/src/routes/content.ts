import type { FastifyInstance } from 'fastify';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { content } from '../db/schema.js';
import { eq, desc, like, and, sql } from 'drizzle-orm';
import { getConfig } from '../config.js';
import { logger } from '../utils/logger.js';
import { mkdirSync, createWriteStream } from 'fs';
import { join } from 'path';
import { pipeline } from 'stream/promises';
import { nanoid } from 'nanoid';

export function registerContentRoutes(fastify: FastifyInstance, db: BetterSQLite3Database<any>) {
  const config = getConfig();

  // List content with filters
  fastify.get<{
    Querystring: { type?: string; status?: string; search?: string; page?: string; limit?: string };
  }>('/api/v1/content', async (request) => {
    const { type, status, search, page = '1', limit = '20' } = request.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const conditions = [];
    if (type) conditions.push(eq(content.type, type as any));
    if (status) conditions.push(eq(content.status, status as any));
    if (search) conditions.push(like(content.title, `%${search}%`));

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const items = db.select().from(content)
      .where(where)
      .orderBy(desc(content.createdAt))
      .limit(parseInt(limit))
      .offset(offset)
      .all();

    const total = db.select({ count: sql<number>`count(*)` }).from(content).where(where).get();

    return {
      items,
      total: total?.count ?? 0,
      page: parseInt(page),
      limit: parseInt(limit),
    };
  });

  // Get single content item
  fastify.get<{ Params: { id: string } }>('/api/v1/content/:id', async (request, reply) => {
    const item = db.select().from(content).where(eq(content.id, request.params.id)).get();
    if (!item) return reply.status(404).send({ error: 'Not found' });
    return item;
  });

  // Upload audio file
  fastify.post('/api/v1/content/upload', async (request, reply) => {
    const data = await request.file();
    if (!data) return reply.status(400).send({ error: 'No file provided' });

    const fields = data.fields as Record<string, any>;
    const type = fields.type?.value || 'podcast';
    const title = fields.title?.value || data.filename;

    // Determine media subdirectory
    const typeDir: Record<string, string> = {
      song: 'songs', podcast: 'podcasts', ad: 'ads', jingle: 'ads', news_block: 'news',
    };
    const subDir = typeDir[type] || 'podcasts';
    const dir = join(config.MEDIA_DIR, subDir);
    mkdirSync(dir, { recursive: true });

    const fileId = nanoid();
    const ext = data.filename.split('.').pop() || 'mp3';
    const fileName = `${fileId}.${ext}`;
    const filePath = join(dir, fileName);
    const relativePath = join(subDir, fileName);

    // Stream file to disk
    const writeStream = createWriteStream(filePath);
    await pipeline(data.file, writeStream);

    const fileSize = writeStream.bytesWritten;

    // Insert into database
    const newItem = db.insert(content).values({
      type: type as any,
      title,
      filePath: relativePath,
      fileSize,
      mimeType: data.mimetype,
      status: 'ready',
      metadata: {},
    }).returning().get();

    logger.info({ id: newItem.id, title, type, fileSize }, 'Content uploaded');
    return reply.status(201).send(newItem);
  });

  // Update content metadata
  fastify.patch<{ Params: { id: string }; Body: { title?: string; artist?: string; metadata?: Record<string, unknown> } }>(
    '/api/v1/content/:id',
    async (request, reply) => {
      const existing = db.select().from(content).where(eq(content.id, request.params.id)).get();
      if (!existing) return reply.status(404).send({ error: 'Not found' });

      const updates: Record<string, any> = { updatedAt: new Date() };
      if (request.body.title) updates.title = request.body.title;
      if (request.body.artist) updates.artist = request.body.artist;
      if (request.body.metadata) updates.metadata = { ...existing.metadata as object, ...request.body.metadata };

      db.update(content).set(updates).where(eq(content.id, request.params.id)).run();
      return db.select().from(content).where(eq(content.id, request.params.id)).get();
    },
  );

  // Delete content
  fastify.delete<{ Params: { id: string } }>('/api/v1/content/:id', async (request, reply) => {
    const existing = db.select().from(content).where(eq(content.id, request.params.id)).get();
    if (!existing) return reply.status(404).send({ error: 'Not found' });

    db.delete(content).where(eq(content.id, request.params.id)).run();
    logger.info({ id: request.params.id, title: existing.title }, 'Content deleted');
    return { success: true };
  });
}
