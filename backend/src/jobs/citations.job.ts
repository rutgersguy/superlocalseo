import { Job } from 'bullmq';
import { db } from '../db/connection';
import { createListingFindRequest, fetchListingFindResult } from '../services/brightlocal.service';
import { getDirectoriesForIndustry } from '../config/industry.config';
import { logger } from '../utils/logger';

const POLL_MAX = 24;
const POLL_INTERVAL_MS = 5000;
const BATCH_SIZE = 10;

interface LocationRow {
  locationId: string;
  clientId: string;
  name: string;
  address: string | null;
  city: string | null;
  state: string | null;
  postcode: string | null;
  telephone: string | null;
  industry: string | null;
}

export async function processCitations(job: Job): Promise<void> {
  const clientId: string | undefined = job.data?.clientId;

  let q = db('locations')
    .join('clients', 'locations.client_id', 'clients.id')
    .whereNotIn('clients.subscription_status', ['canceled', 'past_due'])
    .select(
      'locations.id as locationId',
      'locations.client_id as clientId',
      'locations.name as name',
      'locations.address as address',
      'locations.city as city',
      'locations.state as state',
      'locations.zip as postcode',
      'locations.phone as telephone',
      'clients.industry as industry',
    );

  if (clientId) q = q.where('locations.client_id', clientId);

  const locations = (await q) as LocationRow[];
  logger.info(`Citation job: ${locations.length} locations`);

  let failedLocations = 0;
  let lastError: string | null = null;

  for (const loc of locations) {
    try {
      await syncCitationsForLocation(loc);
    } catch (e) {
      failedLocations += 1;
      lastError = (e as Error).message;
      logger.warn('Citation sync failed', { locationId: loc.locationId, error: lastError });
    }
  }

  // One location failing is a data problem for that location. EVERY location
  // failing is an outage, and the job must not report success — BullMQ marks a
  // thrown job failed, which is what triggers the operator alert in jobs/queue.ts.
  // Without this the job logged "Citation job: 3 locations" and resolved cleanly
  // every single day for three months while writing nothing (#149).
  if (locations.length > 0 && failedLocations === locations.length) {
    throw new Error(
      `Citation sync failed for ALL ${locations.length} location(s). Last error: ${lastError}`,
    );
  }

  if (failedLocations > 0) {
    logger.error('Citation job completed with failures', {
      failed: failedLocations,
      total: locations.length,
      lastError,
    });
  }
}

async function syncCitationsForLocation(loc: LocationRow): Promise<void> {
  const directories = getDirectoriesForIndustry(loc.industry);
  const now = new Date();
  let failedRequests = 0;
  let succeededRequests = 0;

  for (let i = 0; i < directories.length; i += BATCH_SIZE) {
    const batch = directories.slice(i, i + BATCH_SIZE);

    // Fire all find requests in this batch
    const settled = await Promise.allSettled(
      batch.map((directory) =>
        createListingFindRequest({
          businessNames: [loc.name],
          country: 'USA',
          region: loc.state,
          city: loc.city,
          postcode: loc.postcode,
          directory,
          telephone: loc.telephone,
          streetAddress: loc.address,
        }).then((requestId) => ({ directory, requestId })),
      ),
    );

    const fired = settled
      .filter((r): r is PromiseFulfilledResult<{ directory: string; requestId: string }> => r.status === 'fulfilled')
      .map((r) => r.value);
    succeededRequests += fired.length;

    // Rejections used to be dropped here with no logging at all. When BrightLocal's
    // Data API started returning 401 for every call, `fired` was always empty, the
    // poll loop never ran, the "timed out" warning never fired, and the job logged
    // a clean success while writing nothing. Citations silently served data that
    // was 90 days stale (issue #149).
    const rejected = settled.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    if (rejected.length > 0) {
      failedRequests += rejected.length;
      logger.error('Citation find requests failed', {
        locationId: loc.locationId,
        failed: rejected.length,
        of: batch.length,
        // One representative error — logging all of them is noise when the
        // upstream is down and every single call fails identically.
        error: (rejected[0].reason as Error)?.message ?? String(rejected[0].reason),
      });
    }

    // Poll until all ready or max attempts
    const done = new Set<string>();
    for (let attempt = 0; attempt < POLL_MAX && done.size < fired.length; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));

      await Promise.allSettled(
        fired
          .filter((p) => !done.has(p.requestId))
          .map(async (p) => {
            const result = await fetchListingFindResult(p.requestId);
            if (!result.ready) return;
            done.add(p.requestId);

            const nameMatch = result.profile.title
              ? normalizeStr(result.profile.title).includes(normalizeStr(loc.name)) ||
                normalizeStr(loc.name).includes(normalizeStr(result.profile.title))
              : null;
            const addressMatch =
              result.profile.nap?.address && loc.address
                ? normalizeStr(result.profile.nap.address).includes(normalizeStr(loc.address)) ||
                  normalizeStr(loc.address).includes(normalizeStr(result.profile.nap.address))
                : null;
            const phoneMatch =
              result.profile.nap?.telephone && loc.telephone
                ? normalizePhone(result.profile.nap.telephone) === normalizePhone(loc.telephone)
                : null;

            const napMatch = !!(
              nameMatch !== false &&
              addressMatch !== false &&
              phoneMatch !== false &&
              (nameMatch || addressMatch || phoneMatch)
            );

            await db('citation_snapshots').insert({
              location_id: loc.locationId,
              directory: p.directory,
              listed: result.success,
              nap_match: napMatch,
              listing_url: result.profile.urls?.profile ?? null,
              pulled_at: now,
              nap_name_match: nameMatch,
              nap_address_match: addressMatch,
              nap_phone_match: phoneMatch,
              listed_name: result.profile.title ?? null,
              listed_address: result.profile.nap?.address ?? null,
              listed_phone: result.profile.nap?.telephone ?? null,
            });
          }),
      );
    }

    const timedOut = fired.filter((p) => !done.has(p.requestId));
    if (timedOut.length > 0) {
      logger.warn('Citation find timed out', {
        locationId: loc.locationId,
        directories: timedOut.map((p) => p.directory),
      });
    }
  }

  // If EVERY request failed, the upstream is down — not "this location has no
  // listings". Throwing marks the BullMQ job failed, which triggers the operator
  // alert in jobs/queue.ts. Previously this path logged a clean success and wrote
  // nothing, so Citations served 90-day-old data with no signal anywhere (#149).
  if (succeededRequests === 0 && failedRequests > 0) {
    throw new Error(
      `Citation sync failed for every directory (${failedRequests} requests). `
      + 'BrightLocal Data API is unreachable or the key is not entitled to it — '
      + 'note it returns 401 for BOTH an invalid key and an exhausted quota.',
    );
  }

  if (failedRequests > 0) {
    logger.warn('Citation sync partially failed', {
      locationId: loc.locationId,
      succeeded: succeededRequests,
      failed: failedRequests,
    });
  }
}

function normalizeStr(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function normalizePhone(s: string): string {
  return s.replace(/\D/g, '');
}
