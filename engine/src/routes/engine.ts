import type { FastifyInstance } from 'fastify';
import type { Server as SocketIOServer } from 'socket.io';

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
    // Pipeline start will be wired later
    setEngineStatus('running', io);
    return { status: engineStatus };
  });

  fastify.post('/api/v1/engine/stop', async () => {
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
}
