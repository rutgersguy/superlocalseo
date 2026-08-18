import { Job } from 'bullmq';
import { db } from '../db/connection';
import { INDUSTRY_MAP } from '../config/industry.config';
import { directoriesForVertical, verticalForGroup, UNAUDITABLE_KEYS } from '../config/directories.config';
import { scanLocation, LocationNap } from '../services/citation_scan.service';
import { logger } from '../utils/logger';

/**
 * Weekly citation audit (#174).
 *
 * REPLACES BRIGHTLOCAL
 * --------------------
 * This job used to call BrightLocal's Listing Find API, which is not on our
 * account — a 12-month, $500/mo minimum contract we declined (#149). It ran for
 * three months returning 401 for every call while reporting success, so clients
 * saw 90-day-old data presented as current. Discovery now runs on DataForSEO,
 * which we already pay for.
 *
 * MATCHING IS STRICT, DELIBERATELY
 * --------------------------------
 * The BrightLocal path compared NAP with fuzzy `normalizeStr` containment, which
 * treats "505 N Armstrong St Suite Ab" and "505 N Armstrong. Ste AB." as equal.
 * They are not: NAP consistency is an exact-match entity signal, and formatting
 * artifacts are exactly the defect this feature exists to surface. The scanner
 * matches fuzzily to decide "is this us?" and strictly to decide "is it right?".
 *
 * THREE STATES
 * ------------
 * Every scan lands on listed / not_found / unverified. `unverified` is not a
 * failure to be smoothed over — it is the honest answer when we could not
 * determine the truth, and it is excluded from scoring rather than counted
 * against the customer. A false `not_found` sends someone to create a duplicate
 * listing, which actively harms local ranking, so we never guess.
 */
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
  const group = loc.industry ? INDUSTRY_MAP[loc.industry]?.group : null;
  const dirs = directoriesForVertical(verticalForGroup(group));

  const nap: LocationNap = {
    name: loc.name,
    address: loc.address,
    city: loc.city,
    state: loc.state,
    zip: loc.postcode,
    phone: loc.telephone,
  };

  const results = await scanLocation(nap, dirs);
  const now = new Date();

  // An upstream outage must never be written as "not listed". If NOTHING could
  // be determined for this location, treat it as a failure so the job surfaces
  // it, rather than silently persisting a wall of unverified rows that reads to
  // the customer as a completed scan.
  const determined = results.filter((r) => r.status !== 'unverified').length;
  if (results.length > 0 && determined === 0) {
    throw new Error(`Every directory returned unverified for location ${loc.locationId}`);
  }

  const rows = results.map((r) => ({
    location_id: loc.locationId,
    directory: r.directory,
    // Retained for older readers of this table; verification_status is the truth.
    listed: r.status === 'listed',
    verification_status: r.status,
    unverified_reason: r.unverifiedReason ?? null,
    // Only true when every field we COULD read matched. A listing whose NAP we
    // could not read is not "accurate" — it is unchecked, and must not inflate
    // the accuracy figure.
    nap_match:
      r.status === 'listed' &&
      !r.napUnreadable &&
      r.nameMatch !== false &&
      r.addressMatch !== false &&
      r.phoneMatch !== false,
    listing_url: r.listingUrl ?? null,
    pulled_at: now,
    nap_name_match: r.nameMatch ?? null,
    nap_address_match: r.addressMatch ?? null,
    nap_phone_match: r.phoneMatch ?? null,
    listed_name: r.foundName ?? null,
    listed_address: r.foundAddress ?? null,
    listed_phone: r.foundPhone ?? null,
  }));

  // The directories no search-based method can reach are recorded explicitly as
  // unverified rather than omitted, so the UI can show them as "claim this
  // yourself" instead of leaving a silent hole the customer reads as a pass.
  for (const key of UNAUDITABLE_KEYS) {
    rows.push({
      location_id: loc.locationId,
      directory: key,
      listed: false,
      verification_status: 'unverified',
      unverified_reason: 'directory does not publish indexable listings',
      nap_match: false,
      listing_url: null,
      pulled_at: now,
      nap_name_match: null,
      nap_address_match: null,
      nap_phone_match: null,
      listed_name: null,
      listed_address: null,
      listed_phone: null,
    });
  }

  if (rows.length > 0) await db('citation_snapshots').insert(rows);

  const listed = results.filter((r) => r.status === 'listed').length;
  const unverified = results.filter((r) => r.status === 'unverified').length;
  logger.info('Citation scan complete', {
    locationId: loc.locationId,
    directories: results.length,
    listed,
    notFound: results.length - listed - unverified,
    unverified,
  });
}
