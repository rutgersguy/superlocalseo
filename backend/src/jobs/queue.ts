import { Queue, Worker, Job } from 'bullmq';
import { processInitialScans, reconcileInitialScans } from '../services/initial_scans';
import { processProspectReport } from '../services/prospect_report.service';
import { config } from '../config';
import { logger } from '../utils/logger';
import { processRankings } from './rankings.job';
import { processCitations } from './citations.job';
import { processReviews } from './reviews.job';
import { processCompetitors } from './competitors.job';
import { processAudits } from './audits.job';
import { processGeoGrid } from './geogrid.job';
import { processCitationBuilder } from './citations_builder.job';
import { processTrialReminder } from './trial_reminder.job';
import { processAiVisibility } from './ai_visibility.job';
import { sendJobFailureAlert } from '../services/email.service';

// BullMQ v5 needs plain connection options — it creates its own ioredis instances internally.
// maxRetriesPerRequest: null is required for blocking commands (BLPOP).
const redisUrl = new URL(config.redis.url);
const connection = {
  host: redisUrl.hostname,
  port: parseInt(redisUrl.port || '6379'),
  password: redisUrl.password || undefined,
  maxRetriesPerRequest: null as null,
};

export const initialScansQueue = new Queue('initial-scans', { connection });
export const prospectReportsQueue = new Queue('prospect-reports', { connection });
export const rankingsQueue = new Queue('rankings', { connection });
export const citationsQueue = new Queue('citations', { connection });
export const reviewsQueue = new Queue('reviews', { connection });
export const reportsQueue = new Queue('reports', { connection });
export const competitorsQueue = new Queue('competitors', { connection });
export const auditsQueue = new Queue('audits', { connection });
export const geoGridQueue = new Queue('geo-grid', { connection });
export const citationBuilderQueue = new Queue('citation-builder', { connection });
export const trialReminderQueue = new Queue('trial-reminder', { connection });
export const aiVisibilityQueue = new Queue('ai-visibility', { connection });

export async function startWorkers(): Promise<void> {
  const initialWorker = new Worker('initial-scans', async job => job.name === 'reconcile' ? reconcileInitialScans() : processInitialScans(job), { connection, concurrency: 1 });
  initialWorker.on('error', e => logger.error('Initial scans worker error', { error: e.message }));
  await initialScansQueue.add('reconcile', {}, { repeat: { pattern: '* * * * *' } });
  const prospectWorker = new Worker('prospect-reports', async job => processProspectReport(job.data.id), { connection, concurrency: 1 });
  prospectWorker.on('error', e => logger.error('Prospect worker error', { error: e.message }));

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

  const reportsWorker = new Worker(
    'reports',
    async (job: Job) => {
      logger.info('Processing reports job', { jobId: job.id, name: job.name, data: job.data });

      // Fan-out: cron job fires with no clientId → enqueue one job per active client
      if (!job.data.clientId) {
        const { db } = await import('../db/connection');
        const clients = await db('clients')
          .whereNotIn('subscription_status', ['canceled', 'past_due'])
          .select('id') as Array<{ id: string }>;

        logger.info(`Fanning out monthly report jobs for ${clients.length} clients`);

        const now = new Date();
        // Report is for the previous month
        const month = now.getUTCMonth() === 0 ? 12 : now.getUTCMonth();
        const year = now.getUTCMonth() === 0 ? now.getUTCFullYear() - 1 : now.getUTCFullYear();

        for (const client of clients) {
          await reportsQueue.add('generate-report', {
            clientId: client.id,
            month,
            year,
          });
        }
        return;
      }

      // Individual client report job
      const { generateAndSendReport } = await import('../services/report.service');
      await generateAndSendReport(
        job.data.clientId as string,
        job.data.month as number,
        job.data.year as number,
      );
    },
    { connection },
  );

  const competitorsWorker = new Worker(
    'competitors',
    async (job: Job) => {
      logger.info('Processing competitors sync job', { jobId: job.id });
      await processCompetitors(job);
    },
    { connection },
  );

  const auditsWorker = new Worker(
    'audits',
    async (job: Job) => {
      logger.info('Processing audits job', { jobId: job.id, name: job.name });
      await processAudits(job);
    },
    { connection },
  );

  const geoGridWorker = new Worker(
    'geo-grid',
    async (job: Job) => {
      logger.info('Processing geo-grid poll job', { jobId: job.id });
      await processGeoGrid(job);
    },
    { connection },
  );

  const citationBuilderWorker = new Worker(
    'citation-builder',
    async (job: Job) => {
      logger.info('Processing citation builder poll job', { jobId: job.id });
      await processCitationBuilder(job);
    },
    { connection },
  );

  const aiVisibilityWorker = new Worker(
    'ai-visibility',
    async (job: Job) => {
      logger.info('Processing AI visibility job', { jobId: job.id, name: job.name });
      await processAiVisibility(job);
    },
    { connection },
  );

  function alertOnFail(name: string) {
    return (job: { id?: string } | undefined, err: Error) => {
      logger.error(`${name} job failed`, { jobId: job?.id, error: err.message });
      void sendJobFailureAlert(name, err.message, { jobId: job?.id });
    };
  }

  rankingsWorker.on('failed', alertOnFail('rankings'));
  citationsWorker.on('failed', alertOnFail('citations'));
  reviewsWorker.on('failed', alertOnFail('reviews'));
  reportsWorker.on('failed', alertOnFail('reports'));
  competitorsWorker.on('failed', alertOnFail('competitors'));
  auditsWorker.on('failed', alertOnFail('audits'));
  geoGridWorker.on('failed', alertOnFail('geo-grid'));
  citationBuilderWorker.on('failed', alertOnFail('citation-builder'));
  aiVisibilityWorker.on('failed', alertOnFail('ai-visibility'));

  const trialReminderWorker = new Worker('trial-reminder', processTrialReminder, { connection });
  trialReminderWorker.on('failed', alertOnFail('trial-reminder'));

  // Schedule repeatable daily jobs
  await rankingsQueue.add(
    'daily-pull',
    {},
    { repeat: { pattern: '0 6 * * *' } },
  );

  // Monthly monitoring does not purchase Citation Builder submissions.
  await citationsQueue.add('monthly-scan', {}, { repeat: { pattern: '0 7 1 * *', tz: 'UTC' } });
  for (const r of await citationsQueue.getRepeatableJobs()) {
    if (['daily-pull', 'weekly-scan'].includes(r.name)) {
      await citationsQueue.removeRepeatableByKey(r.key);
      logger.info('Removed superseded citation schedule', { key: r.key });
    }
  }

  await reviewsQueue.add(
    'periodic-pull',
    {},
    { repeat: { pattern: '0 */6 * * *' } },
  );

  // Monthly report: 08:00 UTC on the 1st of each month (fan-out job)
  await reportsQueue.add(
    'monthly-reports',
    {},
    { repeat: { pattern: '0 8 1 * *' } },
  );

  // Competitor sync: daily at 05:00 UTC (before rankings pull)
  await competitorsQueue.add(
    'daily-sync',
    {},
    { repeat: { pattern: '0 5 * * *' } },
  );

  // Monthly audit fan-out (1st of month, 9am UTC) + poll pending every 5 min
  await auditsQueue.add('monthly-fan-out', {}, { repeat: { pattern: '0 9 1 * *' } });
  await auditsQueue.add('poll-pending', {}, { repeat: { pattern: '*/5 * * * *' } });

  // Geo-grid poll every 5 min
  await geoGridQueue.add('poll-pending', {}, { repeat: { pattern: '*/5 * * * *' } });

  // Citation builder status poll every 4 hours
  await citationBuilderQueue.add('poll-status', {}, { repeat: { pattern: '0 */4 * * *' } });

  // Trial ending soon — daily at 10:00 UTC
  await trialReminderQueue.add('daily-check', {}, { repeat: { pattern: '0 10 * * *' } });

  // AI assistant visibility: weekly, Monday 08:00 UTC. An hour after the
  // citation scan so the two do not contend for the same DataForSEO rate limit,
  // and weekly because assistant answers track search and review corpora that
  // move on the order of weeks — see ai_visibility.job.ts.
  await aiVisibilityQueue.add('weekly-scan', {}, { repeat: { pattern: '0 8 * * 1' } });

  logger.info('BullMQ workers started');
}
