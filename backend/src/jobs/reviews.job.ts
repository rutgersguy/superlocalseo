import { Job } from 'bullmq';
import { db } from '../db/connection';
import { decrypt } from '../utils/crypto';
import { fetchReviews } from '../services/embedmyreviews.service';
import { logger } from '../utils/logger';

export async function processReviews(_job: Job): Promise<void> {
  // Get all clients with a connected EmbedMyReviews integration
  const integrations = await db('integrations')
    .where({ provider: 'embedmyreviews', status: 'connected' })
    .whereNotNull('api_key_encrypted')
    .select('id', 'client_id', 'api_key_encrypted');

  for (const integration of integrations) {
    try {
      const apiKey = decrypt(integration.api_key_encrypted as string);
      const reviews = await fetchReviews(apiKey);

      const now = new Date();

      for (const review of reviews) {
        const reviewDate = new Date(review.date);

        await db('reviews')
          .insert({
            client_id: integration.client_id,
            location_id: null,
            platform: review.platform,
            external_review_id: review.id,
            author_name: review.author,
            rating: review.rating,
            body: review.body,
            sentiment: null,
            status: 'new',
            review_date: reviewDate,
            ingested_at: now,
            platform_url: review.url,
          })
          .onConflict(['platform', 'external_review_id'])
          .merge({
            author_name: review.author,
            rating: review.rating,
            body: review.body,
            platform_url: review.url,
            ingested_at: now,
          });
      }

      await db('integrations').where({ id: integration.id }).update({ last_pull_at: now });

      logger.info('Reviews pulled successfully', {
        clientId: integration.client_id,
        reviewCount: reviews.length,
      });
    } catch (e) {
      logger.error('Failed to pull reviews for client', {
        clientId: integration.client_id,
        error: (e as Error).message,
      });

      await db('integrations')
        .where({ id: integration.id })
        .update({ error_message: (e as Error).message })
        .catch(() => undefined);
    }
  }
}
