import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { db } from '../db/connection';
import { ok } from '../utils/response';

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
