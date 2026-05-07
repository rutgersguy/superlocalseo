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

  for (const loc of locations) {
    try {
      await syncCitationsForLocation(loc);
    } catch (e) {
      logger.warn('Citation sync failed', { locationId: loc.locationId, error: (e as Error).message });
    }
  }
}

async function syncCitationsForLocation(loc: LocationRow): Promise<void> {
  const directories = getDirectoriesForIndustry(loc.industry);
  const now = new Date();

  for (let i = 0; i < directories.length; i += BATCH_SIZE) {
    const batch = directories.slice(i, i + BATCH_SIZE);

    // Fire all find requests in this batch
    const fired = (
      await Promise.allSettled(
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
      )
    )
      .filter((r): r is PromiseFulfilledResult<{ directory: string; requestId: string }> => r.status === 'fulfilled')
      .map((r) => r.value);

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
}

function normalizeStr(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function normalizePhone(s: string): string {
  return s.replace(/\D/g, '');
}
