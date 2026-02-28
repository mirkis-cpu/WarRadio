import type { FastifyInstance } from 'fastify';
import type { Server as SocketIOServer } from 'socket.io';

// In-memory override queue and now-playing state
interface QueueItem {
  id: string;
  contentId: string;
  title: string;
  contentType: string;
  urgent: boolean;
  addedAt: string;
}

interface NowPlayingState {
  contentId: string;
  title: string;
  type: string;
  progress: number;
  elapsed: number;
  duration: number;
  startedAt: string;
}

const overrideQueue: QueueItem[] = [];
let nowPlaying: NowPlayingState | null = null;

export function getNowPlaying() { return nowPlaying; }
export function setNowPlaying(state: NowPlayingState | null, io?: SocketIOServer) {
  nowPlaying = state;
  if (io && state) io.emit('now-playing:changed', { current: state });
}

export function getOverrideQueue() { return overrideQueue; }

export function registerQueueRoutes(fastify: FastifyInstance, io: SocketIOServer) {
  // Get now playing
  fastify.get('/api/v1/now-playing', async () => {
    return nowPlaying || { status: 'idle' };
  });

  // Get queue
  fastify.get('/api/v1/queue', async () => {
    return { overrides: overrideQueue, count: overrideQueue.length };
  });

  // Insert override (play next)
  fastify.post<{
    Body: { contentId: string; title: string; contentType: string; urgent?: boolean };
  }>('/api/v1/queue/override', async (request, reply) => {
    const item: QueueItem = {
      id: crypto.randomUUID(),
      contentId: request.body.contentId,
      title: request.body.title,
      contentType: request.body.contentType,
      urgent: request.body.urgent || false,
      addedAt: new Date().toISOString(),
    };

    if (item.urgent) {
      overrideQueue.unshift(item);
    } else {
      overrideQueue.push(item);
    }

    io.emit('queue:updated', { items: overrideQueue });
    return reply.status(201).send(item);
  });

  // Remove override
  fastify.delete<{ Params: { id: string } }>('/api/v1/queue/override/:id', async (request, reply) => {
    const index = overrideQueue.findIndex(item => item.id === request.params.id);
    if (index === -1) return reply.status(404).send({ error: 'Not found' });

    overrideQueue.splice(index, 1);
    io.emit('queue:updated', { items: overrideQueue });
    return { success: true };
  });
}
