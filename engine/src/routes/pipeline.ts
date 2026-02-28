import type { FastifyInstance } from 'fastify';
import type { Server as SocketIOServer } from 'socket.io';

interface PipelineJob {
  id: string;
  type: 'song-generation' | 'tts-generation' | 'news-fetch';
  status: 'queued' | 'running' | 'completed' | 'failed';
  progress: number;
  result?: { contentId: string };
  error?: string;
  createdAt: string;
  updatedAt: string;
}

const activeJobs: PipelineJob[] = [];

export function addPipelineJob(job: PipelineJob, io: SocketIOServer) {
  activeJobs.push(job);
  io.emit('pipeline:job-update', job);
}

export function updatePipelineJob(jobId: string, update: Partial<PipelineJob>, io: SocketIOServer) {
  const job = activeJobs.find(j => j.id === jobId);
  if (job) {
    Object.assign(job, update, { updatedAt: new Date().toISOString() });
    io.emit('pipeline:job-update', job);
  }
}

export function registerPipelineRoutes(fastify: FastifyInstance, io: SocketIOServer) {
  // Get pipeline health + active jobs
  fastify.get('/api/v1/pipeline', async () => {
    return {
      jobs: activeJobs.filter(j => j.status === 'running' || j.status === 'queued'),
      recentCompleted: activeJobs.filter(j => j.status === 'completed').slice(-10),
      recentFailed: activeJobs.filter(j => j.status === 'failed').slice(-5),
    };
  });

  // Get all jobs
  fastify.get('/api/v1/pipeline/jobs', async () => {
    return activeJobs.slice(-50); // last 50 jobs
  });

  // Manually trigger song generation
  fastify.post('/api/v1/pipeline/song/trigger', async () => {
    // Will be wired to actual pipeline later
    return { message: 'Song generation triggered', status: 'queued' };
  });

  // Manually trigger news block generation
  fastify.post('/api/v1/pipeline/news/trigger', async () => {
    // Will be wired to actual pipeline later
    return { message: 'News block generation triggered', status: 'queued' };
  });
}
