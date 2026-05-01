import { Job } from 'bullmq';
import { db } from '../db/connection';
import { decrypt } from '../utils/crypto';
import { fetchRankings } from '../services/brightlocal.service';
import { logger } from '../utils/logger';

export async function processRankings(job: Job): Promise<void> {
  const clientId: string | undefined = job.data?.clientId;

  // Get all locations that have a BrightLocal campaign ID configured
  let locationsQuery = db('locations')
    .join('integrations', function () {
      this.on('integrations.client_id', '=', 'locations.client_id')
        .andOn(db.raw("integrations.provider = 'brightlocal'"))
        .andOn(db.raw("integrations.status = 'connected'"));
    })
    .whereNotNull('locations.brightlocal_campaign_id')
    .whereNotNull('integrations.api_key_encrypted')
    .select(
      'locations.id as locationId',
      'locations.client_id as clientId',
      'locations.brightlocal_campaign_id as campaignId',
      'integrations.id as integrationId',
      'integrations.api_key_encrypted as encryptedKey',
    );

  if (clientId) {
    locationsQuery = locationsQuery.where('locations.client_id', clientId);
  }

  const locations = await locationsQuery;

  for (const location of locations) {
    try {
      const apiKey = decrypt(location.encryptedKey as string);
      const results = await fetchRankings(location.campaignId as string);

      for (const result of results) {
        // Find matching keyword for this location
        const keyword = await db('keywords')
          .where({
            location_id: location.locationId,
            keyword: result.keyword,
          })
          .first();

        if (!keyword) {
          // Auto-create keyword if it doesn't exist
          const [newKeyword] = await db('keywords')
            .insert({
              location_id: location.locationId,
              keyword: result.keyword,
              created_at: new Date(),
              updated_at: new Date(),
            })
            .returning('*');

          await db('ranking_snapshots').insert({
            keyword_id: newKeyword.id,
            location_id: location.locationId,
            rank: result.rank,
            url_ranked: result.url,
            search_engine: result.searchEngine,
            rank_type: result.rankType,
            pulled_at: new Date(),
          });
        } else {
          await db('ranking_snapshots').insert({
            keyword_id: keyword.id,
            location_id: location.locationId,
            rank: result.rank,
            url_ranked: result.url,
            search_engine: result.searchEngine,
            rank_type: result.rankType,
            pulled_at: new Date(),
          });
        }
      }

      // Update last_pull_at
      await db('integrations').where({ id: location.integrationId }).update({ last_pull_at: new Date() });

      logger.info('Rankings pulled successfully', {
        locationId: location.locationId,
        resultCount: results.length,
      });
    } catch (e) {
      logger.error('Failed to pull rankings for location', {
        locationId: location.locationId,
        error: (e as Error).message,
      });

      // Update error_message on integration
      await db('integrations')
        .where({ id: location.integrationId })
        .update({ error_message: (e as Error).message })
        .catch(() => undefined);
    }
  }
}
