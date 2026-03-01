import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import { Server as SocketIOServer } from 'socket.io';
import { createServer } from 'http';
import { getConfig } from './config.js';
import { logger } from './utils/logger.js';
import { getDb } from './db/client.js';
import { registerEngineRoutes } from './routes/engine.js';
import { registerContentRoutes } from './routes/content.js';
import { registerScheduleRoutes } from './routes/schedule.js';
import { registerRotationRoutes } from './routes/rotation.js';
import { registerQueueRoutes } from './routes/queue.js';
import { registerSettingsRoutes } from './routes/settings.js';
import { registerPipelineRoutes } from './routes/pipeline.js';
import { registerPodcastRoutes } from './routes/podcast.js';
import { seedDefaultRotation } from './services/seed.js';

const config = getConfig();

const fastify = Fastify({
  logger: false, // We use pino directly
});

const corsOrigins = config.CORS_ORIGINS
  ? config.CORS_ORIGINS.split(',').map(s => s.trim())
  : [`http://localhost:${config.ENGINE_PORT - 1}`, 'http://localhost:3000'];

await fastify.register(cors, {
  origin: corsOrigins,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
});

await fastify.register(multipart, {
  limits: {
    fileSize: 500 * 1024 * 1024, // 500MB max file upload
  },
});

// Initialize database
const db = getDb();

// Seed default rotation pattern
seedDefaultRotation(db);

// Create HTTP server for Socket.io
const httpServer = createServer(fastify.server);

// Socket.io setup
const io = new SocketIOServer(httpServer, {
  cors: {
    origin: [`http://localhost:${config.ENGINE_PORT - 1}`, 'http://localhost:3000'],
    methods: ['GET', 'POST'],
  },
});

// Make io available to routes
fastify.decorate('io', io);

// Health endpoint
fastify.get('/api/v1/health', async () => {
  return { status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString() };
});

// Register all route groups
registerEngineRoutes(fastify, io);
registerContentRoutes(fastify, db);
registerScheduleRoutes(fastify, db);
registerRotationRoutes(fastify, db);
registerQueueRoutes(fastify, io);
registerSettingsRoutes(fastify, db);
registerPipelineRoutes(fastify, io);
registerPodcastRoutes(fastify, io);

// Socket.io connection handling
io.on('connection', (socket) => {
  logger.info({ socketId: socket.id }, 'Dashboard connected');

  socket.on('disconnect', () => {
    logger.info({ socketId: socket.id }, 'Dashboard disconnected');
  });
});

// Start server
try {
  await fastify.listen({ port: config.ENGINE_PORT, host: '0.0.0.0' });
  logger.info({ port: config.ENGINE_PORT }, 'RadioWar Engine started');
} catch (err) {
  logger.fatal(err, 'Failed to start server');
  process.exit(1);
}

// Graceful shutdown
const shutdown = async (signal: string) => {
  logger.info({ signal }, 'Shutdown signal received');
  io.close();
  await fastify.close();
  process.exit(0);
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
