import { Job } from 'bullmq';
import { db } from '../db/connection';
import { createRankingRequest, fetchRankingResult, RankingSearchEngine } from '../services/brightlocal.service';
import { config } from '../config';
import { logger } from '../utils/logger';

export interface SyncResult {
  locationsFound: number;
  locationsWithKeywords: number;
  requestsFired: number;
  snapshotsSaved: number;
  errors: Array<{ locationId: string; message: string }>;
  noKeywords: boolean;
  notConfigured: boolean;
}

const SEARCH_ENGINES: RankingSearchEngine[] = ['google', 'google-local-finder'];
const POLL_MAX_ATTEMPTS = 24;  // 24 × 5s = 2 min max per request
const POLL_INTERVAL_MS = 5000;

async function pollUntilReady(requestId: string) {
  for (let i = 0; i < POLL_MAX_ATTEMPTS; i++) {
    const result = await fetchRankingResult(requestId);
    if (result.ready) return result;
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error(`Request ${requestId} did not complete within ${(POLL_MAX_ATTEMPTS * POLL_INTERVAL_MS) / 1000}s`);
}

export async function syncRankingsForClient(clientId: string): Promise<SyncResult> {
  const result: SyncResult = {
    locationsFound: 0,
    locationsWithKeywords: 0,
    requestsFired: 0,
    snapshotsSaved: 0,
    errors: [],
    noKeywords: false,
    notConfigured: false,
  };

  if (!config.brightlocal.apiKey) {
    result.notConfigured = true;
    return result;
  }

  const clientRow = await db('clients').where({ id: clientId }).select('business_name').first();
  const clientBusinessName = (clientRow as Record<string, unknown> | undefined)?.business_name as string | undefined;

  const locations = await db('locations')
    .where({ client_id: clientId })
    .select('id', 'name', 'city', 'state', 'zip', 'phone', 'website');
  result.locationsFound = locations.length;

  for (const location of locations) {
    const keywords = await db('keywords')
      .where({ location_id: location.id })
      .select('id', 'keyword');

    if (keywords.length === 0) continue;
    result.locationsWithKeywords++;

    const geoLocation = [location.city, location.state, 'United States']
      .filter(Boolean)
      .join(', ') || (location.name as string);

    // Use the client's business name for NAP matching; fall back to the location label.
    const businessName = clientBusinessName ?? (location.name as string);

    // Fire all requests for this location upfront, then poll in parallel
    const pending: Array<{ requestId: string; keywordId: string; keyword: string; engine: string }> = [];

    for (const kw of keywords) {
      for (const engine of SEARCH_ENGINES) {
        try {
          const requestId = await createRankingRequest({
            keyword: kw.keyword as string,
            searchEngine: engine,
            geoLocation,
            websiteUrl: location.website as string | null,
            businessName,
            phone: location.phone as string | null,
            postcode: location.zip as string | null,
          });
          pending.push({ requestId, keywordId: kw.id as string, keyword: kw.keyword as string, engine });
          result.requestsFired++;
        } catch (e) {
          result.errors.push({
            locationId: location.id as string,
            message: `createRankingRequest "${kw.keyword as string}"/${engine}: ${(e as Error).message}`,
          });
        }
      }
    }

    const settled = await Promise.allSettled(pending.map((p) => pollUntilReady(p.requestId)));

    for (let i = 0; i < pending.length; i++) {
      const { keywordId, keyword: kw } = pending[i];
      const outcome = settled[i];

      if (outcome.status === 'rejected') {
        result.errors.push({
          locationId: location.id as string,
          message: `poll "${kw}": ${(outcome.reason as Error).message}`,
        });
        continue;
      }

      const r = outcome.value;
      await db('ranking_snapshots').insert({
        keyword_id: keywordId,
        location_id: location.id,
        rank: r.rank,
        url_ranked: r.url,
        search_engine: r.searchEngine,
        rank_type: r.rankType ?? 'organic',
        pulled_at: new Date(),
      });
      result.snapshotsSaved++;
    }

    logger.info('Rankings synced for location', {
      locationId: location.id,
      requests: pending.length,
      snapshots: result.snapshotsSaved,
    });
  }

  if (result.locationsWithKeywords === 0) result.noKeywords = true;
  return result;
}

export async function processRankings(job: Job): Promise<void> {
  const clientId: string | undefined = job.data?.clientId;

  let query = db('integrations')
    .where({ provider: 'brightlocal', status: 'connected' })
    .select('client_id as clientId', 'id as integrationId');

  if (clientId) {
    query = query.where('client_id', clientId);
  }

  const integrations = await query;

  for (const integration of integrations) {
    try {
      const syncResult = await syncRankingsForClient(integration.clientId as string);
      await db('integrations')
        .where({ id: integration.integrationId })
        .update({ last_pull_at: new Date() });
      logger.info('Rankings sync complete', { clientId: integration.clientId, ...syncResult });
    } catch (e) {
      logger.error('Failed to sync rankings for client', {
        clientId: integration.clientId,
        error: (e as Error).message,
      });
      await db('integrations')
        .where({ id: integration.integrationId })
        .update({ error_message: (e as Error).message })
        .catch(() => undefined);
    }
  }
}
