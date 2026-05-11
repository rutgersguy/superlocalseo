import { Job } from 'bullmq';
import { db } from '../db/connection';
import { getRankForKeyword, getAggregatedSearchVolumes, buildLocationName } from '../services/dataforseo.service';
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

  const clientRow = await db('clients').where({ id: clientId }).select('business_name').first();
  const businessName = (clientRow as Record<string, unknown> | undefined)?.business_name as string | undefined;
  if (!businessName) return result;

  const locations = await db('locations')
    .where({ client_id: clientId })
    .select('id', 'name', 'city', 'state', 'zip', 'phone', 'website', 'service_area');
  result.locationsFound = locations.length;

  for (const location of locations) {
    const keywords = await db('keywords')
      .where({ location_id: location.id })
      .select('id', 'keyword', 'monthly_search_volume');

    if (keywords.length === 0) continue;
    result.locationsWithKeywords++;

    // Backfill missing search volumes
    const missingVolume = keywords.filter((k) => k.monthly_search_volume == null);
    if (missingVolume.length > 0) {
      const serviceArea = (location.service_area as string[]) ?? [];
      const volumes = await getAggregatedSearchVolumes(
        missingVolume.map((k) => k.keyword as string),
        serviceArea,
        location.city as string | null,
        location.state as string | null,
      );
      for (const v of volumes) {
        if (v.monthlySearchVolume != null) {
          const kw = missingVolume.find((k) => (k.keyword as string).toLowerCase() === v.keyword.toLowerCase());
          if (kw) {
            await db('keywords').where({ id: kw.id }).update({
              monthly_search_volume: v.monthlySearchVolume,
              updated_at: new Date(),
            });
          }
        }
      }
    }

    // Build list of geos: primary city + service area cities (capped at 4 extra)
    const serviceArea = (location.service_area as string[]) ?? [];
    const primaryLocationName = buildLocationName(location.city as string | null, location.state as string | null);
    const allGeos: Array<{ locationName: string; geoLabel: string | null }> = [
      { locationName: primaryLocationName, geoLabel: null },
      ...serviceArea.slice(0, 4).map((city) => {
        const [cityPart, statePart] = city.split(',').map((s) => s.trim());
        return { locationName: buildLocationName(cityPart, statePart), geoLabel: city };
      }),
    ];

    for (const { locationName, geoLabel } of allGeos) {
      for (const kw of keywords) {
        try {
          result.requestsFired++;
          const rankResult = await getRankForKeyword({
            keyword: kw.keyword as string,
            locationName,
            businessName,
            websiteUrl: location.website as string | null,
            phone: location.phone as string | null,
          });

          await db('ranking_snapshots').insert({
            keyword_id: kw.id,
            location_id: location.id,
            rank: rankResult.rank,
            url_ranked: rankResult.url,
            search_engine: 'google',
            rank_type: rankResult.rankType ?? 'organic',
            geo_location: geoLabel,
            pulled_at: new Date(),
          });
          result.snapshotsSaved++;
        } catch (e) {
          result.errors.push({
            locationId: location.id as string,
            message: `getRankForKeyword "${kw.keyword as string}"/${geoLabel ?? 'primary'}: ${(e as Error).message}`,
          });
        }
      }
    }

    logger.info('Rankings synced for location', {
      locationId: location.id,
      requests: result.requestsFired,
      snapshots: result.snapshotsSaved,
    });
  }

  if (result.locationsWithKeywords === 0) result.noKeywords = true;
  return result;
}

export async function processRankings(job: Job): Promise<void> {
  const clientId: string | undefined = job.data?.clientId;

  let query = db('clients')
    .whereNotIn('subscription_status', ['canceled', 'past_due'])
    .select('id as clientId');

  if (clientId) query = query.where('id', clientId);

  const clients = await query as Array<{ clientId: string }>;

  for (const { clientId: cid } of clients) {
    try {
      const syncResult = await syncRankingsForClient(cid);
      logger.info('Rankings sync complete', { clientId: cid, ...syncResult });
    } catch (e) {
      logger.error('Failed to sync rankings for client', {
        clientId: cid,
        error: (e as Error).message,
      });
    }
  }
}
