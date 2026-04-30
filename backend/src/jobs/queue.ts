import { Queue, Worker, Job } from 'bullmq';
import { redis } from '../db/redis';
import { logger } from '../utils/logger';
import { processRankings } from './rankings.job';
import { processCitations } from './citations.job';
import { processReviews } from './reviews.job';

const connection = redis;

export const rankingsQueue = new Queue('rankings', { connection });
export const citationsQueue = new Queue('citations', { connection });
export const reviewsQueue = new Queue('reviews', { connection });

export async function startWorkers(): Promise<void> {
  const rankingsWorker = new Worker(
    'rankings',
    async (job: Job) => {
      logger.info('Processing rankings job', { jobId: job.id, name: job.name });
      await processRankings(job);
    },
    { connection },
  );

  const citationsWorker = new Worker(
    'citations',
    async (job: Job) => {
      logger.info('Processing citations job', { jobId: job.id, name: job.name });
      await processCitations(job);
    },
    { connection },
  );

  const reviewsWorker = new Worker(
    'reviews',
    async (job: Job) => {
      logger.info('Processing reviews job', { jobId: job.id, name: job.name });
      await processReviews(job);
    },
    { connection },
  );

  rankingsWorker.on('failed', (job, err) => {
    logger.error('Rankings job failed', { jobId: job?.id, error: err.message });
  });

  citationsWorker.on('failed', (job, err) => {
    logger.error('Citations job failed', { jobId: job?.id, error: err.message });
  });

  reviewsWorker.on('failed', (job, err) => {
    logger.error('Reviews job failed', { jobId: job?.id, error: err.message });
  });

  // Schedule repeatable daily jobs
  await rankingsQueue.add(
    'daily-pull',
    {},
    { repeat: { pattern: '0 6 * * *' } },
  );

  await citationsQueue.add(
    'daily-pull',
    {},
    { repeat: { pattern: '0 7 * * *' } },
  );

  await reviewsQueue.add(
    'periodic-pull',
    {},
    { repeat: { pattern: '0 */6 * * *' } },
  );

  logger.info('BullMQ workers started');
}
