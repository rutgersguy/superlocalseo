import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { db } from '../db/connection';
import { ok, err } from '../utils/response';
import { submitCitations, getCitationSubmissions } from '../services/brightlocal.service';
import { logger } from '../utils/logger';

export const listQuerySchema = z.object({
  locationId: z.string().uuid().optional(),
});

type ListQuery = z.infer<typeof listQuerySchema>;

interface CitationRow {
  location_id: string;
  directory: string;
  listed: boolean;
  nap_match: boolean;
  listing_url: string | null;
  nap_name_match: boolean | null;
  nap_address_match: boolean | null;
  nap_phone_match: boolean | null;
  listed_name: string | null;
  listed_address: string | null;
  listed_phone: string | null;
}

interface LocationCitationSummary {
  locationId: string;
  totalDirectories: number;
  listed: number;
  notListed: number;
  napAccurate: number;
  citations: Array<{
    directory: string;
    listed: boolean;
    napMatch: boolean;
    listingUrl: string | null;
    napDetail: {
      nameMatch: boolean | null;
      addressMatch: boolean | null;
      phoneMatch: boolean | null;
      listedName: string | null;
      listedAddress: string | null;
      listedPhone: string | null;
    };
  }>;
}

export async function list(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const query = req.query as unknown as ListQuery;
    const { locationId } = query;

    // Get latest citation snapshot per directory per location using DISTINCT ON
    let baseQuery = db
      .from(
        db('citation_snapshots')
          .select(
            db.raw('DISTINCT ON (citation_snapshots.location_id, citation_snapshots.directory) citation_snapshots.*'),
          )
          .join('locations', 'citation_snapshots.location_id', 'locations.id')
          .where('locations.client_id', req.clientId)
          .orderByRaw('citation_snapshots.location_id, citation_snapshots.directory, citation_snapshots.pulled_at DESC')
          .as('latest'),
      )
      .select('latest.*');

    if (locationId) {
      baseQuery = baseQuery.where('latest.location_id', locationId);
    }

    const rows = (await baseQuery) as CitationRow[];

    // Group by location
    const byLocation = new Map<string, CitationRow[]>();
    for (const row of rows) {
      if (!byLocation.has(row.location_id)) byLocation.set(row.location_id, []);
      byLocation.get(row.location_id)!.push(row);
    }

    const result: LocationCitationSummary[] = [];
    for (const [locId, citations] of byLocation) {
      const listedCount = citations.filter((c) => c.listed).length;
      const napAccurateCount = citations.filter((c) => c.listed && c.nap_match).length;

      result.push({
        locationId: locId,
        totalDirectories: citations.length,
        listed: listedCount,
        notListed: citations.length - listedCount,
        napAccurate: napAccurateCount,
        citations: citations.map((c) => ({
          directory: c.directory,
          listed: c.listed,
          napMatch: c.nap_match,
          listingUrl: c.listing_url,
          napDetail: {
            nameMatch: c.nap_name_match,
            addressMatch: c.nap_address_match,
            phoneMatch: c.nap_phone_match,
            listedName: c.listed_name,
            listedAddress: c.listed_address,
            listedPhone: c.listed_phone,
          },
        })),
      });
    }

    ok(res, result);
  } catch (e) {
    next(e);
  }
}

// ─── BL-4: Citation Builder ───────────────────────────────────────────────────

const submitSchema = z.object({
  locationId: z.string().uuid(),
  directories: z.array(z.string().min(1)).optional(),
});

export async function submit(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const parsed = submitSchema.safeParse(req.body);
    if (!parsed.success) { err(res, parsed.error.errors[0]?.message ?? 'Validation error', 400, 'VALIDATION_ERROR'); return; }

    const { locationId, directories } = parsed.data;
    const location = await db('locations')
      .where({ id: locationId, client_id: req.clientId })
      .first() as { id: string; brightlocal_campaign_id?: string } | undefined;
    if (!location) { err(res, 'Location not found', 404, 'NOT_FOUND'); return; }
    if (!location.brightlocal_campaign_id) { err(res, 'Location has no BrightLocal campaign configured', 422, 'NO_BL_CAMPAIGN'); return; }

    let targetDirs: string[];
    if (directories && directories.length > 0) {
      targetDirs = directories;
    } else {
      const unlistedRows = await db('citation_snapshots')
        .where({ location_id: locationId, listed: false })
        .select('directory')
        .groupBy('directory') as Array<{ directory: string }>;
      targetDirs = unlistedRows.map((r) => r.directory);
    }

    if (targetDirs.length === 0) { ok(res, { submitted: 0, message: 'No unlisted directories found' }); return; }

    const { jobId } = await submitCitations(location.brightlocal_campaign_id, targetDirs);

    const rows = targetDirs.map((dir) => ({
      client_id: req.clientId,
      location_id: locationId,
      directory: dir,
      status: 'pending',
      bl_submission_id: jobId,
      submitted_at: new Date(),
    }));

    await db('citation_submissions')
      .insert(rows)
      .onConflict(['location_id', 'directory'])
      .merge(['status', 'bl_submission_id', 'submitted_at']);

    ok(res, { submitted: targetDirs.length, jobId }, 202);
  } catch (e) {
    next(e);
  }
}

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

    // Get all location IDs for this client (or filter to specific location)
    let locationQuery = db('locations').where({ client_id: req.clientId }).select('id');
    if (locationId) {
      locationQuery = locationQuery.where({ id: locationId });
    }
    const locationRows = await locationQuery as Array<{ id: string }>;
    const locationIds = locationRows.map((r) => r.id);

    if (locationIds.length === 0) {
      ok(res, { history: [] });
      return;
    }

    const rows = await db.raw<{ rows: Array<{ date: string; listed_count: string; total_count: string }> }>(`
      SELECT DATE(pulled_at) AS date,
             COUNT(CASE WHEN listed = true THEN 1 END) AS listed_count,
             COUNT(*) AS total_count
      FROM citation_snapshots
      WHERE location_id = ANY(?)
        AND pulled_at >= NOW() - INTERVAL '${days} days'
      GROUP BY DATE(pulled_at)
      ORDER BY date ASC
    `, [locationIds]);

    const historyData: HistoryPoint[] = rows.rows.map((r) => {
      const listed = parseInt(r.listed_count, 10);
      const total = parseInt(r.total_count, 10);
      return {
        date: typeof r.date === 'string' ? r.date : (r.date as Date).toISOString().split('T')[0]!,
        listedCount: listed,
        totalCount: total,
        completeness: total > 0 ? Math.round((listed / total) * 100) : 0,
      };
    });

    ok(res, { history: historyData });
  } catch (e) {
    next(e);
  }
}

export async function pollSubmissions(): Promise<void> {
  const pending = await db('citation_submissions')
    .whereIn('status', ['pending', 'submitted'])
    .whereNotNull('bl_submission_id')
    .select('bl_submission_id', 'location_id', 'client_id')
    .groupBy('bl_submission_id', 'location_id', 'client_id') as Array<{ bl_submission_id: string; location_id: string; client_id: string }>;

  for (const row of pending) {
    try {
      const statuses = await getCitationSubmissions(row.bl_submission_id);
      for (const s of statuses) {
        await db('citation_submissions')
          .where({ location_id: row.location_id, directory: s.directory, bl_submission_id: row.bl_submission_id })
          .update({
            status: s.status,
            listing_url: s.listingUrl ?? null,
            rejection_reason: s.rejectionReason ?? null,
            live_at: s.status === 'live' ? new Date() : null,
          });
      }
    } catch (e) {
      logger.warn('Citation submission poll failed', { jobId: row.bl_submission_id, error: (e as Error).message });
    }
  }
}
