import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { db } from '../db/connection';
import { ok, err } from '../utils/response';
import {
  getCbCredits,
  createCbCampaign,
  getCbCampaignLookup,
  confirmCbCampaign,
  getCbCampaign,
  findOrProvisionBlLocation,
  type CbPackageId,
  type CbPublisher,
} from '../services/brightlocal.service';
import { citationHistory, napVerdict } from '../services/measurement.service';
import { logger } from '../utils/logger';

export const listQuerySchema = z.object({
  locationId: z.string().uuid().optional(),
});

type ListQuery = z.infer<typeof listQuerySchema>;

interface CitationRow {
  location_id: string;
  location_name: string;
  directory: string;
  pulled_at: string | Date | null;
  listed: boolean;
  verification_status: 'listed' | 'not_found' | 'unverified';
  unverified_reason: string | null;
  nap_match: boolean | null;
  listing_url: string | null;
  nap_name_match: boolean | null;
  nap_address_match: boolean | null;
  nap_phone_match: boolean | null;
  listed_name: string | null;
  listed_address: string | null;
  listed_phone: string | null;
}


export async function list(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const query = req.query as unknown as ListQuery;
    const { locationId } = query;

    // Latest snapshot per directory per location (DISTINCT ON)
    let baseQuery = db
      .from(
        db('citation_snapshots')
          .select(
            db.raw('DISTINCT ON (citation_snapshots.location_id, citation_snapshots.directory) citation_snapshots.*'),
            'locations.name as location_name',
          )
          .join('locations', 'citation_snapshots.location_id', 'locations.id')
          .where('locations.client_id', req.clientId)
          .orderByRaw('citation_snapshots.location_id, citation_snapshots.directory, citation_snapshots.pulled_at DESC, citation_snapshots.id DESC')
          .as('latest'),
      )
      .select('latest.*');

    if (locationId) {
      baseQuery = baseQuery.where('latest.location_id', locationId);
    }

    const rows = (await baseQuery) as CitationRow[];

    // Preserve each location: a healthy listing must not hide another location’s issue.
    // Self-attested claims for the directories no audit can reach (#173).
    const claimRows = await db('location_directory_claims')
      .join('locations', 'location_directory_claims.location_id', 'locations.id')
      .where('locations.client_id', req.clientId)
      .modify((q) => { if (locationId) q.where('location_directory_claims.location_id', locationId); })
      .select('location_directory_claims.location_id', 'location_directory_claims.directory', 'location_directory_claims.claimed_at');
    const claims = new Map(claimRows.map((c: { location_id: string; directory: string; claimed_at: Date }) => [JSON.stringify([c.location_id, c.directory]), c.claimed_at]));

    const directories = rows.map((c) => ({
      id: JSON.stringify([c.location_id, c.directory]),
      locationId: c.location_id,
      locationName: c.location_name,
      pulledAt: c.pulled_at,
      name: c.directory,
      // `listed` is retained for older clients; verificationStatus is the truth.
      listed: c.listed,
      verificationStatus: c.verification_status ?? (c.listed ? 'listed' : 'not_found'),
      unverifiedReason: c.unverified_reason ?? null,
      claimedAt: claims.get(JSON.stringify([c.location_id, c.directory])) ?? null,
      napMatch: napVerdict(c),
      listingUrl: c.listing_url,
      napDetail: {
        nameMatch: c.nap_name_match,
        addressMatch: c.nap_address_match,
        phoneMatch: c.nap_phone_match,
        listedName: c.listed_name,
        listedAddress: c.listed_address,
        listedPhone: c.listed_phone,
      },
    }));

    const listedCount = directories.filter((d) => d.verificationStatus === 'listed').length;
    const notFoundCount = directories.filter((d) => d.verificationStatus === 'not_found').length;
    // Counted and reported, never hidden. A directory we could not check is our
    // limitation, so it is excluded from the denominator rather than counted
    // against the customer.
    const unverifiedCount = directories.filter((d) => d.verificationStatus === 'unverified').length;
    // Divides by listings whose NAP we could READ. Dividing by every listed
    // directory drags the figure down for listings we never compared — the
    // customer would see "50% NAP accurate" and go hunting for a fault that
    // does not exist.
    const napCheckedCount = directories.filter(
      (d) => d.verificationStatus === 'listed' && d.napMatch !== null,
    ).length;
    const napAccurateCount = directories.filter(
      (d) => d.verificationStatus === 'listed' && d.napMatch === true,
    ).length;
    const napAccuratePercent = napCheckedCount > 0 ? Math.round((napAccurateCount / napCheckedCount) * 100) : null;

    // When this data was last actually refreshed. The Citations page presented
    // whatever was in the table as current, so when the BrightLocal Data API
    // started 401ing (see #149) clients were shown 90-day-old listing status with
    // nothing to indicate it was stale. Surfacing the timestamp lets the UI say so.
    const pulledTimes = rows
      .map((r) => (r.pulled_at ? new Date(r.pulled_at).getTime() : NaN))
      .filter((t) => Number.isFinite(t));
    const lastPulledAt = pulledTimes.length > 0
      ? new Date(Math.max(...pulledTimes)).toISOString()
      : null;

    ok(res, {
      directories,
      totalDirectories: directories.length,
      listedCount,
      notFoundCount,
      unverifiedCount,
      /** Directories that produced a definite answer — the honest denominator. */
      checkedCount: listedCount + notFoundCount,
      napCheckedCount,
      napAccuratePercent,
      lastPulledAt,
    });
  } catch (e) {
    next(e);
  }
}

// ─── Citation Builder (Management API v1) ────────────────────────────────────
// Multi-step flow: create campaign → poll lookup → confirm with package
// Requires brightlocal_location_id (integer) set on the location record.

export async function getCbCreditsHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const credits = await getCbCredits();
    ok(res, { credits });
  } catch (e) {
    next(e);
  }
}

const createCampaignSchema = z.object({
  locationId: z.string().uuid(),
});

export async function createCampaign(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const parsed = createCampaignSchema.safeParse(req.body);
    if (!parsed.success) { err(res, parsed.error.errors[0]?.message ?? 'Validation error', 400, 'VALIDATION_ERROR'); return; }

    const { locationId } = parsed.data;
    const location = await db('locations')
      .where({ id: locationId, client_id: req.clientId })
      .first() as {
        id: string;
        name: string;
        address: string | null;
        city: string | null;
        state: string | null;
        zip: string | null;
        phone: string | null;
        website: string | null;
        brightlocal_location_id?: number | null;
      } | undefined;
    if (!location) { err(res, 'Location not found', 404, 'NOT_FOUND'); return; }

    let blLocationId = location.brightlocal_location_id;
    if (!blLocationId) {
      try {
        blLocationId = await findOrProvisionBlLocation(location);
        await db('locations').where({ id: locationId }).update({ brightlocal_location_id: blLocationId });
      } catch (provErr) {
        err(res, `Could not register location with BrightLocal: ${(provErr as Error).message}`, 422, 'BL_PROVISION_FAILED');
        return;
      }
    }

    const campaignId = await createCbCampaign(blLocationId);
    ok(res, { campaignId }, 201);
  } catch (e) {
    next(e);
  }
}

export async function getCampaignLookup(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { campaignId } = req.params;
    const result = await getCbCampaignLookup(campaignId);
    ok(res, result);
  } catch (e) {
    next(e);
  }
}

const confirmCampaignSchema = z.object({
  packageId: z.enum(['cb0', 'cb10', 'cb15', 'cb25', 'cb30', 'cb50', 'cb75', 'cb100']),
  citations: z.array(z.string()).default([]),
  publishers: z.array(z.enum(['dataaxle', 'neustar', 'foursquare', 'gpsnetwork', 'ypnetwork', 'locafynetwork'])).default([]),
  autoSelect: z.boolean().default(false),
  removeDuplicates: z.boolean().default(false),
  notes: z.string().optional(),
  express: z.boolean().default(false),
  locationId: z.string().uuid(),
});

export async function confirmCampaign(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const parsed = confirmCampaignSchema.safeParse(req.body);
    if (!parsed.success) { err(res, parsed.error.errors[0]?.message ?? 'Validation error', 400, 'VALIDATION_ERROR'); return; }

    const { campaignId } = req.params;
    const { locationId, ...opts } = parsed.data;

    const location = await db('locations').where({ id: locationId, client_id: req.clientId }).first();
    if (!location) { err(res, 'Location not found', 404, 'NOT_FOUND'); return; }

    await confirmCbCampaign(campaignId, {
      packageId: opts.packageId as CbPackageId,
      citations: opts.citations,
      publishers: opts.publishers as CbPublisher[],
      autoSelect: opts.autoSelect,
      removeDuplicates: opts.removeDuplicates,
      notes: opts.notes,
      express: opts.express,
    });

    // Record confirmed citations as pending submissions for tracking
    const now = new Date();
    const rows = opts.citations.map((domain) => ({
      client_id: req.clientId as string,
      location_id: locationId,
      directory: domain,
      status: 'pending',
      bl_submission_id: campaignId,
      submitted_at: now,
    }));
    if (rows.length > 0) {
      await db('citation_submissions')
        .insert(rows)
        .onConflict(['location_id', 'directory'])
        .merge(['status', 'bl_submission_id', 'submitted_at']);
    }

    ok(res, { message: 'Campaign confirmed' });
  } catch (e) {
    next(e);
  }
}

export async function getCampaignStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { campaignId } = req.params;
    const campaign = await getCbCampaign(campaignId);
    ok(res, campaign);
  } catch (e) {
    next(e);
  }
}

// Legacy no-op — kept for route compatibility; new submissions tracked via getCampaignStatus
export async function listSubmissions(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { locationId } = req.query as Record<string, string>;
    let q = db('citation_submissions')
      .where({ client_id: req.clientId })
      .orderBy('submitted_at', 'desc');
    if (locationId) q = q.where({ location_id: locationId });
    const rows = await q as Array<Record<string, unknown>>;
    ok(res, {
      submissions: rows.map((r) => ({
        id: r.id,
        locationId: r.location_id,
        directory: r.directory,
        status: r.status,
        listingUrl: r.listing_url,
        rejectionReason: r.rejection_reason,
        submittedAt: r.submitted_at,
        liveAt: r.live_at,
      })),
    });
  } catch (e) {
    next(e);
  }
}

// ─── Citation History ─────────────────────────────────────────────────────────

export const historyQuerySchema = z.object({
  locationId: z.string().uuid().optional(),
  days: z.coerce.number().int().min(1).max(365).default(90),
});

type HistoryQuery = z.infer<typeof historyQuerySchema>;

interface HistoryPoint {
  date: string;
  listedCount: number;
  totalCount: number;
  completeness: number;
}

export async function history(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const parsed = historyQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      err(res, parsed.error.errors[0]?.message ?? 'Validation error', 400, 'VALIDATION_ERROR');
      return;
    }
    const { locationId, days } = parsed.data as HistoryQuery;

    const historyData = await citationHistory(req.clientId, days, locationId);

    ok(res, { history: historyData });
  } catch (e) {
    next(e);
  }
}

// Polls active CB campaigns (stored in bl_submission_id) via Management API v1
// and syncs per-citation status back to citation_submissions.
export async function pollSubmissions(): Promise<void> {
  const pending = await db('citation_submissions')
    .whereIn('status', ['pending', 'submitted'])
    .whereNotNull('bl_submission_id')
    .select('bl_submission_id', 'location_id', 'client_id')
    .groupBy('bl_submission_id', 'location_id', 'client_id') as Array<{ bl_submission_id: string; location_id: string; client_id: string }>;

  for (const row of pending) {
    try {
      const campaign = await getCbCampaign(row.bl_submission_id);
      for (const c of campaign.citations) {
        await db('citation_submissions')
          .where({ location_id: row.location_id, directory: c.domain, bl_submission_id: row.bl_submission_id })
          .update({
            status: c.status ?? 'pending',
            listing_url: c.listingUrl ?? null,
            live_at: c.liveAt ? new Date(c.liveAt) : null,
          });
      }
    } catch (e) {
      logger.warn('Citation campaign poll failed', { campaignId: row.bl_submission_id, error: (e as Error).message });
    }
  }
}


// ─── Self-attested directory claims (#173) ───────────────────────────────────
//
// Apple Maps and Bing Places publish nothing indexable, so no audit we can run
// will ever see them. The customer claims them through the free self-serve
// portals and ticks them off here.
//
// This is self-attestation and is recorded as such: it MUST NOT feed any score
// or be presented as verified, because we have checked precisely nothing.

const claimSchema = z.object({
  locationId: z.string().uuid(),
  directory: z.string().min(1).max(50),
});

/** Confirms the location belongs to the caller. Never trust a body-supplied id. */
async function assertOwnedLocation(clientId: string | undefined, locationId: string): Promise<boolean> {
  const row = await db('locations').where({ id: locationId, client_id: clientId }).first('id');
  return !!row;
}

export async function claimDirectory(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const parsed = claimSchema.safeParse(req.body);
    if (!parsed.success) { err(res, parsed.error.errors[0]?.message ?? 'Validation error', 400, 'VALIDATION_ERROR'); return; }
    const { locationId, directory } = parsed.data;

    if (!(await assertOwnedLocation(req.clientId, locationId))) { err(res, 'Location not found', 404, 'NOT_FOUND'); return; }

    await db('location_directory_claims')
      .insert({ location_id: locationId, directory })
      .onConflict(['location_id', 'directory'])
      .merge({ claimed_at: db.fn.now() });

    ok(res, { locationId, directory, claimed: true });
  } catch (e) {
    next(e);
  }
}

export async function unclaimDirectory(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const parsed = claimSchema.safeParse(req.body);
    if (!parsed.success) { err(res, parsed.error.errors[0]?.message ?? 'Validation error', 400, 'VALIDATION_ERROR'); return; }
    const { locationId, directory } = parsed.data;

    if (!(await assertOwnedLocation(req.clientId, locationId))) { err(res, 'Location not found', 404, 'NOT_FOUND'); return; }

    await db('location_directory_claims').where({ location_id: locationId, directory }).del();
    ok(res, { locationId, directory, claimed: false });
  } catch (e) {
    next(e);
  }
}
