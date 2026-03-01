import { nanoid } from 'nanoid';
import type { FastifyInstance } from 'fastify';
import type { Server as SocketIOServer } from 'socket.io';
import { logger } from '../utils/logger.js';
import { RssService } from '../services/rss-service.js';
import { LyricsService } from '../services/lyrics-service.js';
import { PodcastService, type PodcastEpisode } from '../services/podcast-service.js';

const episodes: PodcastEpisode[] = [];
const MAX_EPISODES = 50;

let generating = false;

export function registerPodcastRoutes(fastify: FastifyInstance, io: SocketIOServer) {
  const rssService = new RssService();
  const lyricsService = new LyricsService();
  const podcastService = new PodcastService();

  // Manually trigger podcast generation
  fastify.post('/api/v1/podcast/generate', async (_req, reply) => {
    if (generating) {
      reply.status(409);
      return { error: 'Podcast generation already in progress' };
    }

    const jobId = nanoid();
    generating = true;
    io.emit('podcast:generating', { jobId });

    // Run async — don't block the response
    void (async () => {
      try {
        logger.info({ jobId }, 'Manual podcast generation started');

        // Fetch news
        const articles = await rssService.fetchOnce();
        if (articles.length === 0) {
          throw new Error('No articles available for podcast');
        }

        // Synthesize stories (reuse lyrics service synthesis)
        const stories = await lyricsService.synthesizeNews(articles, 10);
        if (stories.length === 0) {
          throw new Error('News synthesis produced no stories');
        }

        // Generate podcast
        const episode = await podcastService.generateEpisode(stories);

        episodes.push(episode);
        if (episodes.length > MAX_EPISODES) {
          episodes.splice(0, episodes.length - MAX_EPISODES);
        }

        io.emit('podcast:generated', episode);
        logger.info({ jobId, title: episode.title }, 'Manual podcast generation complete');
      } catch (err) {
        logger.error({ err, jobId }, 'Manual podcast generation failed');
        io.emit('podcast:error', { jobId, error: String(err) });
      } finally {
        generating = false;
      }
    })();

    return { status: 'generating', jobId };
  });

  // Get latest episode
  fastify.get('/api/v1/podcast/latest', async () => {
    if (episodes.length === 0) {
      return null;
    }
    return episodes[episodes.length - 1];
  });

  // List recent episodes
  fastify.get('/api/v1/podcast/episodes', async () => {
    return episodes.slice(-20).reverse();
  });

  // Get generation status
  fastify.get('/api/v1/podcast/status', async () => {
    return {
      generating,
      totalEpisodes: episodes.length,
      latestEpisode: episodes.length > 0 ? episodes[episodes.length - 1].title : null,
    };
  });
}
