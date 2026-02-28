import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.js';
import { getConfig } from '../config.js';
import { logger } from '../utils/logger.js';
import { mkdirSync } from 'fs';
import { dirname } from 'path';

let _db: ReturnType<typeof drizzle> | null = null;

export function getDb() {
  if (!_db) {
    const dbPath = getConfig().DATABASE_PATH;
    mkdirSync(dirname(dbPath), { recursive: true });

    const sqlite = new Database(dbPath);
    sqlite.pragma('journal_mode = WAL');
    sqlite.pragma('foreign_keys = ON');

    _db = drizzle(sqlite, { schema });
    logger.info({ dbPath }, 'Database connected');

    // Create tables if they don't exist
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS content (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL CHECK(type IN ('song', 'podcast', 'news_block', 'ad', 'jingle')),
        title TEXT NOT NULL,
        artist TEXT,
        duration INTEGER,
        file_path TEXT,
        file_size INTEGER,
        mime_type TEXT,
        status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('ready', 'generating', 'error', 'pending')),
        metadata TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS schedule_slots (
        id TEXT PRIMARY KEY,
        content_id TEXT REFERENCES content(id) ON DELETE CASCADE,
        content_type TEXT CHECK(content_type IN ('song', 'podcast', 'news_block', 'ad', 'jingle', 'any')),
        start_time INTEGER NOT NULL,
        end_time INTEGER,
        is_recurring INTEGER DEFAULT 0,
        recurrence_rule TEXT,
        priority INTEGER DEFAULT 5,
        label TEXT,
        color TEXT,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS rotation_pattern (
        id TEXT PRIMARY KEY,
        position INTEGER NOT NULL,
        content_type TEXT NOT NULL CHECK(content_type IN ('song', 'podcast', 'news_block', 'ad', 'jingle')),
        content_id TEXT REFERENCES content(id),
        selection_strategy TEXT DEFAULT 'least_recently_played' CHECK(selection_strategy IN ('random', 'sequential', 'least_recently_played')),
        pattern_group_id TEXT NOT NULL DEFAULT 'default'
      );

      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS playback_log (
        id TEXT PRIMARY KEY,
        content_id TEXT REFERENCES content(id),
        content_type TEXT NOT NULL,
        title TEXT,
        started_at INTEGER NOT NULL,
        ended_at INTEGER,
        source TEXT NOT NULL CHECK(source IN ('rotation', 'scheduled', 'override', 'manual'))
      );
    `);

    logger.info('Database tables initialized');
  }
  return _db;
}
