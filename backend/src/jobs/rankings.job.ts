import { Job } from 'bullmq';
import { db } from '../db/connection';
import { decrypt } from '../utils/crypto';
import { fetchRankings } from '../services/brightlocal.service';
import { logger } from '../utils/logger';

export interface SyncResult {
  locationsFound: number;
  locationsWithCampaign: number;
  snapshotsSaved: number;
  errors: Array<{ locationId: string; message: string }>;
  noCampaignIds: boolean;
  noIntegration: boolean;
}

export async function syncRankingsForClient(clientId: string): Promise<SyncResult> {
  const result: SyncResult = {
    locationsFound: 0,
    locationsWithCampaign: 0,
    snapshotsSaved: 0,
    errors: [],
    noCampaignIds: false,
    noIntegration: false,
  };

  // Check if any BrightLocal integration exists for this client
  const integration = await db('integrations')
    .where({ client_id: clientId, provider: 'brightlocal', status: 'connected' })
    .whereNotNull('api_key_encrypted')
    .first();

  if (!integration) {
    result.noIntegration = true;
    return result;
  }

  // Get all locations for this client
  const allLocations = await db('locations').where({ client_id: clientId }).select('id', 'brightlocal_campaign_id');
  result.locationsFound = allLocations.length;

  const campaignLocations = allLocations.filter((l: Record<string, unknown>) => l.brightlocal_campaign_id);
  result.locationsWithCampaign = campaignLocations.length;

  if (campaignLocations.length === 0) {
    result.noCampaignIds = true;
    return result;
  }

  for (const location of campaignLocations) {
    try {
      const results = await fetchRankings(location.brightlocal_campaign_id as string);

      for (const r of results) {
        let keyword = await db('keywords').where({ location_id: location.id, keyword: r.keyword }).first();
        if (!keyword) {
          const [kw] = await db('keywords').insert({
            location_id: location.id,
            keyword: r.keyword,
            created_at: new Date(),
            updated_at: new Date(),
          }).returning('*');
          keyword = kw;
        }
        await db('ranking_snapshots').insert({
          keyword_id: (keyword as Record<string, unknown>).id,
          location_id: location.id,
          rank: r.rank,
          url_ranked: r.url,
          search_engine: r.searchEngine,
          rank_type: r.rankType,
          pulled_at: new Date(),
        });
        result.snapshotsSaved++;
      }

      await db('integrations').where({ id: (integration as Record<string, unknown>).id }).update({ last_pull_at: new Date() });
      logger.info('Rankings pulled successfully', { locationId: location.id, resultCount: results.length });
    } catch (e) {
      const msg = (e as Error).message;
      result.errors.push({ locationId: location.id as string, message: msg });
      logger.error('Failed to pull rankings for location', { locationId: location.id, error: msg });
      await db('integrations').where({ id: (integration as Record<string, unknown>).id }).update({ error_message: msg }).catch(() => undefined);
    }
  }

  return result;
}

export async function processRankings(job: Job): Promise<void> {
  const clientId: string | undefined = job.data?.clientId;

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
      decrypt(location.encryptedKey as string); // validate key is decryptable
      const results = await fetchRankings(location.campaignId as string);

      for (const result of results) {
        const keyword = await db('keywords').where({ location_id: location.locationId, keyword: result.keyword }).first();
        if (!keyword) {
          const [newKeyword] = await db('keywords').insert({
            location_id: location.locationId,
            keyword: result.keyword,
            created_at: new Date(),
            updated_at: new Date(),
          }).returning('*');
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

      await db('integrations').where({ id: location.integrationId }).update({ last_pull_at: new Date() });
      logger.info('Rankings pulled successfully', { locationId: location.locationId, resultCount: results.length });
    } catch (e) {
      logger.error('Failed to pull rankings for location', { locationId: location.locationId, error: (e as Error).message });
      await db('integrations').where({ id: location.integrationId }).update({ error_message: (e as Error).message }).catch(() => undefined);
    }
  }
}
