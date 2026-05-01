import { Job } from 'bullmq';
import { db } from '../db/connection';
import { syncCompetitorPlaces } from '../controllers/competitor.controller';
import { config } from '../config';
import { logger } from '../utils/logger';

export async function processCompetitors(_job: Job): Promise<void> {
  if (!config.googlePlacesApiKey) {
    logger.warn('Competitors sync skipped — GOOGLE_PLACES_API_KEY not set');
    return;
  }

  const competitors = await db('competitors')
    .whereNotNull('google_place_id')
    .select('id', 'google_place_id', 'client_id');

  for (const c of competitors) {
    try {
      await syncCompetitorPlaces(c.id as string, c.google_place_id as string);
    } catch (e) {
      logger.warn('Failed to sync competitor', {
        competitorId: c.id,
        error: (e as Error).message,
      });
    }
  }

  logger.info('Competitors sync complete', { count: competitors.length });
}
