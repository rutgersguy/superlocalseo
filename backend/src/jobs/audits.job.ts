import { Job } from 'bullmq';
import { db } from '../db/connection';
import { createAuditReport } from '../services/brightlocal.service';
import { getRankForKeyword, buildLocationName } from '../services/dataforseo.service';
import { getPrimaryKeyword } from '../config/industry.config';
import { pollPending } from '../controllers/audit_bl.controller';
import { logger } from '../utils/logger';

export async function processAudits(job: Job): Promise<void> {
  if (job.name === 'poll-pending') {
    await pollPending();
    return;
  }

  if (!job.data.locationId) {
    // Monthly fan-out: all active locations, regardless of BL campaign status.
    const locations = await db('locations')
      .join('clients', 'locations.client_id', 'clients.id')
      .whereNotIn('clients.subscription_status', ['canceled', 'past_due'])
      .select(
        'locations.id as locationId',
        'locations.client_id as clientId',
        'locations.name as name',
        'locations.city as city',
        'locations.state as state',
        'locations.zip as zip',
        'locations.phone as phone',
        'locations.website as website',
        'clients.industry as industry',
        'clients.business_name as businessName',
      ) as Array<{
        locationId: string; clientId: string; name: string; city: string | null;
        state: string | null; zip: string | null; phone: string | null; website: string | null;
        industry: string | null; businessName: string | null;
      }>;

    logger.info(`Audit fan-out: ${locations.length} locations`);

    for (const loc of locations) {
      try {
        // Skip if an audit was run in the last 23 hours (fan-out is daily, allow 1-hour buffer)
        const recent = await db('location_audits')
          .where({ location_id: loc.locationId })
          .where('created_at', '>', new Date(Date.now() - 23 * 60 * 60 * 1000))
          .first();
        if (recent) continue;

        const reportId: string | null = null;
        {
        }

        await db('location_audits').insert({
          client_id: loc.clientId,
          location_id: loc.locationId,
          bl_report_id: reportId,
          status: 'processing',
          completed_at: null,
        });

        // Industry keyword ranking check for every location
        const primaryKeyword = getPrimaryKeyword(loc.industry, loc.city);
        if (primaryKeyword) {
          void fireRankingCheck(loc, primaryKeyword);
        }
      } catch (e) {
        logger.warn('Audit fan-out failed for location', { locationId: loc.locationId, error: (e as Error).message });
      }
    }
    return;
  }

  await pollPending();
}

async function fireRankingCheck(
  loc: { locationId: string; name: string; city: string | null; state: string | null; phone: string | null; website: string | null; businessName: string | null },
  keyword: string,
): Promise<void> {
  try {
    const exists = await db('keywords').where({ location_id: loc.locationId, keyword }).first();
    if (!exists) {
      await db('keywords').insert({ location_id: loc.locationId, keyword, created_at: new Date(), updated_at: new Date() });
    }

    const locationName = buildLocationName(loc.city, loc.state);
    const result = await getRankForKeyword({
      keyword,
      locationName,
      businessName: loc.businessName ?? loc.name,
      websiteUrl: loc.website,
      phone: loc.phone,
    });

    const kw = await db('keywords').where({ location_id: loc.locationId, keyword }).first() as { id: string } | undefined;
    if (kw) {
      await db('ranking_snapshots').insert({
        keyword_id: kw.id,
        location_id: loc.locationId,
        rank: result.rank,
        url_ranked: result.url,
        search_engine: 'google',
        rank_type: result.rankType ?? 'organic',
        pulled_at: new Date(),
      });
    }
  } catch (e) {
    logger.warn('Audit ranking check failed', { locationId: loc.locationId, keyword, error: (e as Error).message });
  }
}
