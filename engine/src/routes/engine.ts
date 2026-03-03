import type { FastifyInstance } from 'fastify';
import type { Server as SocketIOServer } from 'socket.io';
import { getPipeline } from '../services/pipeline.js';
import { SunoApiGenerator } from '../suno/api-generator.js';
import { downloadAudio } from '../suno/downloader.js';
import { getConfig } from '../config.js';
import { logger } from '../utils/logger.js';
import path from 'path';
import { mkdirSync } from 'fs';

// Engine state
let engineStatus: 'stopped' | 'starting' | 'running' | 'paused' | 'error' = 'stopped';

export function getEngineStatus() {
  return engineStatus;
}

export function setEngineStatus(status: typeof engineStatus, io?: SocketIOServer) {
  engineStatus = status;
  io?.emit('engine:status-changed', { status });
}

export function registerEngineRoutes(fastify: FastifyInstance, io: SocketIOServer) {
  fastify.get('/api/v1/engine/status', async () => {
    return {
      status: engineStatus,
      uptime: process.uptime(),
      memoryUsage: process.memoryUsage(),
      timestamp: new Date().toISOString(),
    };
  });

  fastify.post('/api/v1/engine/start', async () => {
    if (engineStatus === 'running') {
      return { status: engineStatus, message: 'Already running' };
    }
    setEngineStatus('starting', io);
    const pipeline = getPipeline();
    pipeline.start().catch((err) => {
      setEngineStatus('error', io);
      console.error('Pipeline start failed:', err);
    });
    setEngineStatus('running', io);
    return { status: engineStatus };
  });

  fastify.post('/api/v1/engine/stop', async () => {
    const pipeline = getPipeline();
    await pipeline.stop();
    setEngineStatus('stopped', io);
    return { status: engineStatus };
  });

  fastify.post('/api/v1/engine/pause', async () => {
    if (engineStatus === 'running') {
      setEngineStatus('paused', io);
    } else if (engineStatus === 'paused') {
      setEngineStatus('running', io);
    }
    return { status: engineStatus };
  });

  // ── Stream routes ────────────────────────────────────────────────────────

  fastify.get('/api/v1/stream/status', async () => {
    const pipeline = getPipeline();
    const stream = pipeline.getStreamStatus();
    return stream ?? { isStreaming: false, startedAt: null, currentTrack: null, tracksPlayed: 0, uptimeSeconds: 0, errors: 0 };
  });

  fastify.post('/api/v1/stream/start', async (_req, reply) => {
    const pipeline = getPipeline();
    try {
      await pipeline.startStream();
      io.emit('stream:status-changed', { isStreaming: true });
      return { status: 'started' };
    } catch (err) {
      reply.status(400);
      return { error: String(err) };
    }
  });

  fastify.post('/api/v1/stream/stop', async () => {
    const pipeline = getPipeline();
    pipeline.stopStream();
    io.emit('stream:status-changed', { isStreaming: false });
    return { status: 'stopped' };
  });

  // ── Test: single song generation via API ─────────────────────────────────
  fastify.post('/api/v1/test/single-song', async (_req, reply) => {
    logger.info('=== SINGLE SONG API TEST START ===');

    try {
      const generator = new SunoApiGenerator();
      const credits = await generator.getCredits().catch(() => -1);
      logger.info({ credits }, 'Suno API credits');

      const t = Date.now();

      const results = await generator.generate({
        style: 'country rock, twangy guitar, steady drums, patriotic anthem',
        lyrics: `[Verse]\nSteel rain falling from the sky tonight\nBomber jets blazing through the fading light\nOld glory waving on the desert ground\nFreedom has a heavy sound\n\n[Chorus]\nSteel rain falling down on foreign land\nUncle Sam extending his iron hand\nYou can run but you will never hide\nSteel rain falling on the other side`,
        title: 'Steel Rain Test',
      });

      // Download the first result
      const config = getConfig();
      const today = new Date().toISOString().slice(0, 10);
      const dir = path.join(config.MEDIA_DIR, 'songs', today);
      mkdirSync(dir, { recursive: true });

      const downloaded = [];
      for (const result of results) {
        const outPath = path.join(dir, `test-${result.clipId}.mp3`);
        await downloadAudio(result.audioUrl, outPath);
        downloaded.push({ clipId: result.clipId, audioUrl: result.audioUrl, filePath: outPath, duration: result.duration });
      }

      const elapsed = ((Date.now() - t) / 1000).toFixed(1);
      logger.info({ songs: downloaded.length, elapsed }, '=== SINGLE SONG API TEST SUCCESS ===');

      return {
        status: 'success',
        songs: downloaded,
        elapsedSeconds: elapsed,
        creditsRemaining: credits,
      };
    } catch (err) {
      logger.error({ error: String(err) }, '=== SINGLE SONG API TEST FAILED ===');
      reply.status(500);
      return { error: String(err) };
    }
  });
}
