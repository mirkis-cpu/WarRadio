import { eq, and, gte, lte, asc, desc } from 'drizzle-orm';
import { content, scheduleSlots, rotationPattern, playbackLog, settings } from '../db/schema.js';
import type { Content, ScheduleSlot, RotationStep } from '../db/schema.js';
import { logger } from '../utils/logger.js';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

export interface ScheduledItem {
  contentId: string;
  title: string;
  contentType: string;
  filePath: string;
  duration: number;
  source: 'override' | 'scheduled' | 'rotation';
}

interface OverrideItem {
  id: string;
  contentId: string;
  title: string;
  contentType: string;
  urgent: boolean;
}

export class Scheduler {
  private overrideQueue: OverrideItem[] = [];
  private rotationCursor = 0;

  constructor(private db: BetterSQLite3Database<any>) {
    // Load persisted cursor
    const saved = this.db.select().from(settings).where(eq(settings.key, 'rotationCursor')).get();
    if (saved) {
      this.rotationCursor = saved.value as number;
    }
  }

  /**
   * Add an override item to play next
   */
  addOverride(item: OverrideItem): void {
    if (item.urgent) {
      this.overrideQueue.unshift(item);
    } else {
      this.overrideQueue.push(item);
    }
    logger.info({ title: item.title, urgent: item.urgent }, 'Override added to queue');
  }

  /**
   * Remove an override by ID
   */
  removeOverride(id: string): boolean {
    const index = this.overrideQueue.findIndex(item => item.id === id);
    if (index === -1) return false;
    this.overrideQueue.splice(index, 1);
    return true;
  }

  /**
   * Get the next item to play using priority queue logic:
   * 1. Override queue (manual "play next")
   * 2. Scheduled slots (timeline editor, time-anchored)
   * 3. Default rotation pattern
   * 4. null (nothing available)
   */
  getNextItem(): ScheduledItem | null {
    // 1. Check override queue
    const override = this.checkOverrideQueue();
    if (override) return override;

    // 2. Check scheduled slots
    const scheduled = this.checkScheduledSlots();
    if (scheduled) return scheduled;

    // 3. Default rotation
    const rotation = this.checkRotation();
    if (rotation) return rotation;

    // 4. Nothing available
    logger.warn('No content available from any source');
    return null;
  }

  private checkOverrideQueue(): ScheduledItem | null {
    if (this.overrideQueue.length === 0) return null;

    const item = this.overrideQueue.shift()!;
    const contentItem = this.db.select().from(content)
      .where(and(
        eq(content.id, item.contentId),
        eq(content.status, 'ready'),
      ))
      .get();

    if (!contentItem || !contentItem.filePath) {
      logger.warn({ contentId: item.contentId }, 'Override content not found or not ready');
      return this.checkOverrideQueue(); // Try next override
    }

    return {
      contentId: contentItem.id,
      title: contentItem.title,
      contentType: contentItem.type,
      filePath: contentItem.filePath,
      duration: contentItem.duration || 180,
      source: 'override',
    };
  }

  private checkScheduledSlots(): ScheduledItem | null {
    const now = new Date();
    const lookAhead = new Date(now.getTime() + 60_000); // 60 seconds ahead

    const slot = this.db.select().from(scheduleSlots)
      .where(and(
        gte(scheduleSlots.startTime, now),
        lte(scheduleSlots.startTime, lookAhead),
      ))
      .orderBy(desc(scheduleSlots.priority), asc(scheduleSlots.startTime))
      .get();

    if (!slot) return null;

    // If slot has specific content
    if (slot.contentId) {
      const contentItem = this.db.select().from(content)
        .where(and(
          eq(content.id, slot.contentId),
          eq(content.status, 'ready'),
        ))
        .get();

      if (contentItem?.filePath) {
        // Remove the slot after use (unless recurring)
        if (!slot.isRecurring) {
          this.db.delete(scheduleSlots).where(eq(scheduleSlots.id, slot.id)).run();
        }

        return {
          contentId: contentItem.id,
          title: contentItem.title,
          contentType: contentItem.type,
          filePath: contentItem.filePath,
          duration: contentItem.duration || 180,
          source: 'scheduled',
        };
      }
    }

    // Slot has type but no specific content - pick from library
    if (slot.contentType && slot.contentType !== 'any') {
      return this.pickByType(slot.contentType as string, 'scheduled');
    }

    return null;
  }

  private checkRotation(): ScheduledItem | null {
    const pattern = this.db.select().from(rotationPattern)
      .where(eq(rotationPattern.patternGroupId, 'default'))
      .orderBy(asc(rotationPattern.position))
      .all();

    if (pattern.length === 0) return null;

    // Try each position in the pattern starting from cursor
    for (let i = 0; i < pattern.length; i++) {
      const step = pattern[(this.rotationCursor + i) % pattern.length];
      const item = this.pickForRotationStep(step);

      if (item) {
        // Advance cursor past the used position
        this.rotationCursor = (this.rotationCursor + i + 1) % pattern.length;
        this.persistCursor();
        return item;
      }
    }

    return null;
  }

  private pickForRotationStep(step: RotationStep): ScheduledItem | null {
    // If step has specific content
    if (step.contentId) {
      const contentItem = this.db.select().from(content)
        .where(and(
          eq(content.id, step.contentId),
          eq(content.status, 'ready'),
        ))
        .get();

      if (contentItem?.filePath) {
        return {
          contentId: contentItem.id,
          title: contentItem.title,
          contentType: contentItem.type,
          filePath: contentItem.filePath,
          duration: contentItem.duration || 180,
          source: 'rotation',
        };
      }
    }

    // Pick by type using selection strategy
    return this.pickByType(step.contentType, 'rotation', step.selectionStrategy || 'least_recently_played');
  }

  private pickByType(
    type: string,
    source: 'scheduled' | 'rotation',
    strategy: string = 'least_recently_played',
  ): ScheduledItem | null {
    let contentItem: Content | undefined;

    if (strategy === 'random') {
      const items = this.db.select().from(content)
        .where(and(eq(content.type, type as any), eq(content.status, 'ready')))
        .all()
        .filter(c => c.filePath);

      if (items.length === 0) return null;
      contentItem = items[Math.floor(Math.random() * items.length)];
    } else if (strategy === 'least_recently_played') {
      // Find content of this type that was played least recently
      const items = this.db.select().from(content)
        .where(and(eq(content.type, type as any), eq(content.status, 'ready')))
        .all()
        .filter(c => c.filePath);

      if (items.length === 0) return null;

      // Get last play time for each
      let leastRecent: Content | null = null;
      let leastRecentTime = Infinity;

      for (const item of items) {
        const lastPlay = this.db.select().from(playbackLog)
          .where(eq(playbackLog.contentId, item.id))
          .orderBy(desc(playbackLog.startedAt))
          .get();

        const playTime = lastPlay?.startedAt ? new Date(lastPlay.startedAt).getTime() : 0;
        if (playTime < leastRecentTime) {
          leastRecentTime = playTime;
          leastRecent = item;
        }
      }

      contentItem = leastRecent || items[0];
    } else {
      // sequential - just get the oldest ready content
      contentItem = this.db.select().from(content)
        .where(and(eq(content.type, type as any), eq(content.status, 'ready')))
        .orderBy(asc(content.createdAt))
        .get() as Content | undefined;
    }

    if (!contentItem?.filePath) return null;

    return {
      contentId: contentItem.id,
      title: contentItem.title,
      contentType: contentItem.type,
      filePath: contentItem.filePath,
      duration: contentItem.duration || 180,
      source,
    };
  }

  private persistCursor(): void {
    const existing = this.db.select().from(settings).where(eq(settings.key, 'rotationCursor')).get();
    if (existing) {
      this.db.update(settings).set({
        value: this.rotationCursor as any,
        updatedAt: new Date(),
      }).where(eq(settings.key, 'rotationCursor')).run();
    } else {
      this.db.insert(settings).values({
        key: 'rotationCursor',
        value: this.rotationCursor as any,
      }).run();
    }
  }

  /**
   * Log a playback event
   */
  logPlayback(item: ScheduledItem): void {
    this.db.insert(playbackLog).values({
      contentId: item.contentId,
      contentType: item.contentType,
      title: item.title,
      startedAt: new Date(),
      source: item.source,
    }).run();
  }

  /**
   * Get recent playback history
   */
  getRecentHistory(limit = 20): Array<typeof playbackLog.$inferSelect> {
    return this.db.select().from(playbackLog)
      .orderBy(desc(playbackLog.startedAt))
      .limit(limit)
      .all();
  }

  getOverrideQueue(): OverrideItem[] {
    return [...this.overrideQueue];
  }
}
