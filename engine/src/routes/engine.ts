import type { FastifyInstance } from 'fastify';
import type { Server as SocketIOServer } from 'socket.io';
import { getPipeline } from '../services/pipeline.js';

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
}
