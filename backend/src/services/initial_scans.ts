import { Job } from 'bullmq';
import { config } from '../config';
import { connectionState } from './emr_connection_state';
import { listConnectLinks } from './embedmyreviews.service';
import { db } from '../db/connection';
import { logger } from '../utils/logger';
import { INITIAL_STEPS, InitialStep, initialWaitingReason } from './initial_scan_policy';
import { syncRankingsForClient } from '../jobs/rankings.job';
import { processCitations } from '../jobs/citations.job';
import { processAiVisibility } from '../jobs/ai_visibility.job';
import { processReviews } from '../jobs/reviews.job';
import { providerRoutes } from './provider_routing';
import { computeAuditScores } from './audit_score.service';
import { getRankForCoordinate } from './dataforseo.service';

/** Enroll only the explicitly saved customer's locations. Never backfill all tenants. */
export async function ensureInitialScans(clientId: string, locationId?: string): Promise<void> {
  const locations = await db('locations').where({ client_id: clientId }).modify(q => { if (locationId) q.where({ id: locationId }); }).select('id');
  for (const loc of locations) {
    await db('initial_scans').insert(INITIAL_STEPS.map(step => ({ client_id: clientId, location_id: loc.id, step }))).onConflict(['location_id', 'step']).ignore();
    try {
      const { initialScansQueue } = await import('../jobs/queue');
      await initialScansQueue.add('initial-location', { clientId, locationId: loc.id }, { jobId: `initial-location-${loc.id}`, removeOnComplete: true, removeOnFail: true });
    } catch (e) {
      // Enrollment is durable. The minute reconciliation finds it after Redis recovers.
      logger.warn('Initial scans queued for recovery', { locationId: loc.id, error: (e as Error).message });
    }
  }
}

export async function reconcileInitialScans(): Promise<void> {
  const rows = await db('initial_scans').where({ status: 'waiting' }).distinct('client_id', 'location_id');
  const { initialScansQueue } = await import('../jobs/queue');
  for (const row of rows) await initialScansQueue.add('initial-location', { clientId: row.client_id, locationId: row.location_id }, { jobId: `initial-location-${row.location_id}`, removeOnComplete: true, removeOnFail: true });
}

async function hasEvidence(step: InitialStep, locationId: string): Promise<boolean> {
  const tables: Record<InitialStep, string> = { rankings: 'ranking_snapshots', citations: 'citation_snapshots', ai: 'ai_visibility_snapshots', reviews: 'review_sync_state', map: 'geo_grid_reports', audit: 'location_audits' };
  // Imported rows may predate the health ledger; preserve them without another read.
  if (step === 'reviews') return Boolean(await db('reviews').where({ location_id: locationId }).first());
  let q = db(tables[step]).where({ location_id: locationId });
  if (['map', 'audit'].includes(step)) q = q.whereIn('status', ['complete', 'processing', 'pending']);
  return Boolean(await q.first());
}

export async function processInitialScans(job: Job): Promise<void> {
  const { clientId, locationId } = job.data ?? {};
  if (!clientId || !locationId) throw new Error('Initial scans require an explicit client and location');
  const loc = await db('locations').join('clients', 'clients.id', 'locations.client_id')
    .where({ 'locations.id': locationId, 'locations.client_id': clientId })
    .select('locations.*', 'clients.subscription_status', 'clients.trial_ends_at', 'clients.product_line', 'clients.industry').first();
  if (!loc) return;
  const keyword = await db('keywords').where({ location_id: locationId }).orderBy('created_at').orderBy('id').first();
  const connected = await db('integrations').where({ client_id: clientId, provider: 'embedmyreviews', status: 'connected' }).whereNotNull('api_key_encrypted').first();
  // Mapping prerequisites must not prevent unrelated SEO scans.
  const reviewRoutes = connected ? await providerRoutes(clientId, locationId).catch(() => []) : [];
  const hasReviewConnection = reviewRoutes.length > 0;
  for (const step of INITIAL_STEPS) {
    const key = { client_id: clientId, location_id: locationId, step };
    const row = await db('initial_scans').where(key).first();
    if (row?.status === 'running') {
      if (new Date(row.started_at).getTime() > Date.now() - 20 * 60 * 1000) return;
      // Never reclaim an interrupted paid attempt, but let unrelated checks proceed.
      await db('initial_scans').where(key).where({ status: 'running' }).update({ status: 'needs_attention', reason: 'The initial attempt was interrupted or is taking longer than expected. Support must check it before retrying.', updated_at: new Date() });
      continue;
    }
    if (!row || row.status !== 'waiting') continue;
    if (await hasEvidence(step, locationId)) {
      await db('initial_scans').where(key).where({ status: 'waiting' }).update({ status: 'existing', reason: 'Existing scan data retained.', completed_at: new Date(), updated_at: new Date() });
      continue;
    }
    let profileSelected = hasReviewConnection;
    if (step === 'reviews' && profileSelected) {
      profileSelected = Boolean(config.embedmyreviews.apiKey) && (await Promise.all(reviewRoutes.map(async route => {
        try { return connectionState(await listConnectLinks(config.embedmyreviews.apiKey, Number(route.providerLocationId), 'google')).profileSelected; }
        catch { return false; }
      }))).every(Boolean);
    }
    const reason = initialWaitingReason(step, loc, Boolean(keyword), profileSelected);
    if (reason) { await db('initial_scans').where(key).where({ status: 'waiting' }).update({ reason, updated_at: new Date() }); continue; }
    // Adopt the explicit pilot jobs started before this ledger was deployed.
    if (['rankings', 'citations', 'ai'].includes(step)) {
      const queues = await import('../jobs/queue');
      const queue = step === 'rankings' ? queues.rankingsQueue : step === 'citations' ? queues.citationsQueue : queues.aiVisibilityQueue;
      const previous = await queue.getJob(`initial-${step}-${locationId}`);
      if (previous) {
        const state = await previous.getState();
        if (['waiting', 'active', 'delayed', 'waiting-children', 'prioritized'].includes(state)) {
          await db('initial_scans').where(key).where({ status: 'waiting' }).update({ reason: 'An initial scan is already queued or running.', updated_at: new Date() });
          return;
        }
        // A completed/failed source job without observations is not safe to repurchase.
        await db('initial_scans').where(key).where({ status: 'waiting' }).update({ status: 'needs_attention', reason: 'A previous initial scan finished without usable saved observations. Support must review it before retrying.', updated_at: new Date() });
        continue;
      }
    }
    // CAS before paid work. An interrupted/uncertain attempt is never auto-repurchased.
    const claimed = await db('initial_scans').where(key).where({ status: 'waiting' }).update({ status: 'running', reason: null, started_at: new Date(), updated_at: new Date() });
    if (!claimed) return;
    try {
      const scoped = { data: { clientId, locationId, emrOnly: true }, name: 'initial' } as Job;
      if (step === 'rankings') {
        const result = await syncRankingsForClient(clientId, locationId);
        if (!result.snapshotsSaved || result.errors.length) throw new Error('Some ranking observations were unavailable');
      } else if (step === 'citations') await processCitations(scoped);
      else if (step === 'ai') await processAiVisibility(scoped);
      else if (step === 'reviews') {
        await processReviews(scoped);
        const states = await db('review_sync_state').where({ client_id: clientId }).whereIn('provider_location_id', reviewRoutes.map(r => r.providerLocationId));
        if (states.length !== reviewRoutes.length || states.some(s => s.status !== 'succeeded')) throw new Error('Review import did not confirm a successful scoped read');
      } else if (step === 'map') await runInitialMap(clientId, loc, keyword);
      else await runInitialAudit(clientId, loc);
      await db('initial_scans').where(key).update({ status: 'complete', reason: step === 'audit' ? 'Website checks saved. A submitted performance check may still be processing.' : null, completed_at: new Date(), updated_at: new Date() });
    } catch (e) {
      await db('initial_scans').where(key).update({ status: 'needs_attention', reason: 'The initial attempt did not fully complete. Existing observations are retained; support must review before retrying.', updated_at: new Date() });
      logger.warn('Initial scan needs attention', { clientId, locationId, step, error: (e as Error).message });
    }
  }
}

async function runInitialAudit(clientId: string, loc: Record<string, any>): Promise<void> {
  const scores = await computeAuditScores(loc.id, loc.industry ?? null);
  await db('location_audits').insert({ client_id: clientId, location_id: loc.id, status: 'complete',
    nap_score: scores.napScore, citation_score: scores.citationScore, composite_score: scores.compositeScore,
    on_page_score: scores.onPageScore, on_page_details: JSON.stringify(scores.onPageDetails), dfs_on_page_task_id: scores.dfsLighthouseTaskId ?? null,
    raw_data: JSON.stringify({ scoreMethodology: 'verified_observations_v2' }), completed_at: new Date(), backfill_attempted_at: new Date() });
  if (scores.onPageScore == null && !scores.dfsLighthouseTaskId) throw new Error('Website checks unavailable; saved SEO observations retained');
}

async function runInitialMap(clientId: string, loc: Record<string, any>, keyword: Record<string, any>): Promise<void> {
  const [report] = await db('geo_grid_reports').insert({ client_id: clientId, location_id: loc.id, keyword_id: keyword.id, status: 'processing', grid_size: 3, center_lat: loc.lat, center_lng: loc.lng }).returning('id');
  const points = [];
  try {
    // A bounded 9-point first sample, sequential to avoid provider request bursts.
    for (let row = -1; row <= 1; row++) for (let col = -1; col <= 1; col++) {
      const lat = Number(loc.lat) + row * 0.0145;
      const lng = Number(loc.lng) + col * 0.0145 / Math.max(0.1, Math.cos(Number(loc.lat) * Math.PI / 180));
      const result = await getRankForCoordinate({ keyword: keyword.keyword, lat, lng, businessName: loc.name, websiteUrl: loc.website, phone: loc.phone });
      points.push({ gridRow: row, gridCol: col, lat, lng, rank: result.rank, url: result.url });
      await db('geo_grid_reports').where({ id: report.id }).update({ grid_data: JSON.stringify(points) });
    }
    await db('geo_grid_reports').where({ id: report.id }).update({ status: 'complete', completed_at: new Date() });
  } catch (e) {
    await db('geo_grid_reports').where({ id: report.id }).update({ status: 'failed' });
    throw e;
  }
}
