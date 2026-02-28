import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
import { nanoid } from 'nanoid';

export const content = sqliteTable('content', {
  id: text('id').primaryKey().$defaultFn(() => nanoid()),
  type: text('type', { enum: ['song', 'podcast', 'news_block', 'ad', 'jingle'] }).notNull(),
  title: text('title').notNull(),
  artist: text('artist'),
  duration: integer('duration'), // seconds
  filePath: text('file_path'),
  fileSize: integer('file_size'),
  mimeType: text('mime_type'),
  status: text('status', { enum: ['ready', 'generating', 'error', 'pending'] }).notNull().default('pending'),
  metadata: text('metadata', { mode: 'json' }).$type<Record<string, unknown>>(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
});

export const scheduleSlots = sqliteTable('schedule_slots', {
  id: text('id').primaryKey().$defaultFn(() => nanoid()),
  contentId: text('content_id').references(() => content.id, { onDelete: 'cascade' }),
  contentType: text('content_type', { enum: ['song', 'podcast', 'news_block', 'ad', 'jingle', 'any'] }),
  startTime: integer('start_time', { mode: 'timestamp' }).notNull(),
  endTime: integer('end_time', { mode: 'timestamp' }),
  isRecurring: integer('is_recurring', { mode: 'boolean' }).default(false),
  recurrenceRule: text('recurrence_rule'),
  priority: integer('priority').default(5),
  label: text('label'),
  color: text('color'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
});

export const rotationPattern = sqliteTable('rotation_pattern', {
  id: text('id').primaryKey().$defaultFn(() => nanoid()),
  position: integer('position').notNull(),
  contentType: text('content_type', { enum: ['song', 'podcast', 'news_block', 'ad', 'jingle'] }).notNull(),
  contentId: text('content_id').references(() => content.id),
  selectionStrategy: text('selection_strategy', { enum: ['random', 'sequential', 'least_recently_played'] }).default('least_recently_played'),
  patternGroupId: text('pattern_group_id').notNull().default('default'),
});

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value', { mode: 'json' }).notNull().$type<unknown>(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
});

export const playbackLog = sqliteTable('playback_log', {
  id: text('id').primaryKey().$defaultFn(() => nanoid()),
  contentId: text('content_id').references(() => content.id),
  contentType: text('content_type').notNull(),
  title: text('title'),
  startedAt: integer('started_at', { mode: 'timestamp' }).notNull(),
  endedAt: integer('ended_at', { mode: 'timestamp' }),
  source: text('source', { enum: ['rotation', 'scheduled', 'override', 'manual'] }).notNull(),
});

// Type exports
export type Content = typeof content.$inferSelect;
export type NewContent = typeof content.$inferInsert;
export type ScheduleSlot = typeof scheduleSlots.$inferSelect;
export type NewScheduleSlot = typeof scheduleSlots.$inferInsert;
export type RotationStep = typeof rotationPattern.$inferSelect;
export type PlaybackEntry = typeof playbackLog.$inferSelect;
