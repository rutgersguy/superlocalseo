import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { db } from '../db/connection';
import { ok, notFound } from '../utils/response';
import { AI_ENGINES, AI_PROMPTS, aiEngineLabel } from '../config/ai_engines.config';
import { Plan } from '../config/planFeatures';

/**
 * AI assistant visibility (#191).
 *
 * PLAN SPLIT IS ENFORCED HERE, NOT IN THE UI
 * ------------------------------------------
 * Lite sees the verdict — which assistants name the business and where it
 * ranks — because that is the claim the landing page converts on, and paywalling
 * it would sell someone a promise they cannot open. Pro adds the depth: the
 * competitors each assistant named instead, the sources it cited, the
 * week-over-week history, and the stored answer itself.
 *
 * The Pro fields are OMITTED FROM THE PAYLOAD for Lite rather than hidden by the
 * frontend. `planFeatures.ts` records why: "hiding a control whose endpoint is
 * not gated is theatre", and #157 is four Pro-marketed surfaces that rendered
 * for Lite because only the UI knew about the gate.
 *
 * `unverified` IS NOT `absent`
 * ----------------------------
 * The three states are carried through to the client verbatim and the mention
 * rate is computed over determinate checks only. An assistant that failed, or a
 * business name too generic to detect, must never reach the customer as "you are
 * not recommended" — see ai_visibility.service.ts.
 */

export const listQuerySchema = z.object({
  locationId: z.string().uuid().optional(),
});
type ListQuery = z.infer<typeof listQuerySchema>;

interface SnapshotRow {
  id: string;
  location_id: string;
  location_name: string;
  prompt_key: string;
  prompt_text: string;
  engine: string;
  model_name: string;
  status: 'mentioned' | 'absent' | 'unverified';
  unverified_reason: string | null;
  position: number | null;
  businesses_named: string[];
  citations: string[];
  scanned_at: Date;
}

function planOf(req: Request): Plan {
  if (req.userRole === 'admin') return 'pro';
  return ((req.client?.product_line as string | null) ?? 'pro') as Plan;
}

/** The scan runs Mondays 08:00 UTC — see jobs/queue.ts. */
function nextScanAt(from: Date): Date {
  const next = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate(), 8, 0, 0));
  // getUTCDay(): 0=Sun, 1=Mon. Days until the next Monday 08:00 strictly ahead of `from`.
  let delta = (1 - next.getUTCDay() + 7) % 7;
  if (delta === 0 && next <= from) delta = 7;
  next.setUTCDate(next.getUTCDate() + delta);
  return next;
}

/**
 * Turn an internal unverified reason into something a customer can read.
 *
 * The stored reason is written for us and names the vendor and its status codes
 * — "assistant unavailable: DataForSEO /ai_optimization/gemini/llm_responses/live
 * failed after 4 attempts: task status 40102". That shipped to the dashboard on
 * first render. It tells a plumber nothing, and it discloses which upstream we
 * buy from, which is not the customer's business.
 *
 * The raw text stays in the column, because that is what makes an outage
 * diagnosable. Only the rendering is translated.
 */
function friendlyReason(raw: string | null): string | null {
  if (!raw) return null;

  if (raw.startsWith('assistant unavailable')) {
    return "We couldn't get an answer from this assistant. We'll try again on the next scan — it isn't counted for or against you.";
  }
  if (raw.includes('generic trade and location words')) {
    return 'Your business name is made up of common words for your trade and area, so we cannot reliably tell it apart from ordinary text in the answer. Get in touch and we will set up a custom match.';
  }
  if (raw.includes('named no businesses')) {
    return "The assistant didn't name any businesses in its answer, so there was nothing to compare against.";
  }
  return "We couldn't complete this check. It isn't counted for or against you.";
}

export async function summary(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { locationId } = req.query as unknown as ListQuery;
    const plan = planOf(req);
    const isPro = plan === 'pro';

    let locQ = db('locations').where('client_id', req.clientId).select('id', 'name');
    if (locationId) locQ = locQ.where('id', locationId);
    const locations = (await locQ) as Array<{ id: string; name: string }>;

    if (locations.length === 0) {
      ok(res, { plan, scannedAt: null, nextScanAt: null, locations: [], engines: [], prompts: [] });
      return;
    }

    const locationIds = locations.map((l) => l.id);

    // The latest run. Every row written by one run shares a scanned_at, so the
    // max IS the run — no separate run id is needed.
    const latest = (await db('ai_visibility_snapshots')
      .whereIn('location_id', locationIds)
      .max('scanned_at as scanned_at')
      .first()) as { scanned_at: Date | null } | undefined;

    const scannedAt = latest?.scanned_at ?? null;

    // NB: the comparison below re-derives the max in SQL rather than sending
    // `scannedAt` back as a bind parameter. Postgres stores timestamptz to
    // microseconds and a JS Date holds only milliseconds, so a round-tripped
    // value silently matches NOTHING — the roll-up came back all zeros while
    // the history aggregate, which never leaves SQL, read 60%.

    if (!scannedAt) {
      ok(res, {
        plan,
        scannedAt: null,
        nextScanAt: nextScanAt(new Date()).toISOString(),
        locations,
        engines: [],
        prompts: [],
      });
      return;
    }

    const rows = (await db('ai_visibility_snapshots as s')
      .join('locations as l', 's.location_id', 'l.id')
      .whereIn('s.location_id', locationIds)
      .where('s.scanned_at', '=', db('ai_visibility_snapshots')
        .whereIn('location_id', locationIds)
        .max('scanned_at'))
      .select(
        's.id',
        's.location_id',
        'l.name as location_name',
        's.prompt_key',
        's.prompt_text',
        's.engine',
        's.model_name',
        's.status',
        's.unverified_reason',
        's.position',
        's.businesses_named',
        's.citations',
        's.scanned_at',
      )) as SnapshotRow[];

    // ── Per-engine roll-up ───────────────────────────────────────────────────
    const engines = AI_ENGINES.filter((e) => e.enabled).map((e) => {
      const mine = rows.filter((r) => r.engine === e.key);
      const mentioned = mine.filter((r) => r.status === 'mentioned');
      const absent = mine.filter((r) => r.status === 'absent');
      const unverified = mine.filter((r) => r.status === 'unverified');
      const positions = mentioned.map((r) => r.position).filter((p): p is number => p != null);

      return {
        engine: e.key,
        label: e.label,
        mentioned: mentioned.length,
        absent: absent.length,
        unverified: unverified.length,
        // Rate over DETERMINATE checks only. Counting unverified as a miss
        // would let an outage read as a drop in visibility.
        determinate: mentioned.length + absent.length,
        bestPosition: positions.length ? Math.min(...positions) : null,
      };
    });

    // ── Per-prompt detail ────────────────────────────────────────────────────
    const prompts = AI_PROMPTS.map((p) => {
      const mine = rows.filter((r) => r.prompt_key === p.key);
      if (mine.length === 0) return null;

      return {
        promptKey: p.key,
        promptText: mine[0].prompt_text,
        intent: p.intent,
        results: mine.map((r) => ({
          snapshotId: r.id,
          engine: r.engine,
          label: aiEngineLabel(r.engine),
          modelName: r.model_name,
          status: r.status,
          position: r.position,
          unverifiedReason: friendlyReason(r.unverified_reason),
          locationName: r.location_name,
          // Pro depth — omitted entirely for Lite, not merely hidden.
          ...(isPro
            ? {
                businessesNamed: r.businesses_named ?? [],
                citations: r.citations ?? [],
              }
            : {}),
        })),
      };
    }).filter(Boolean);

    const determinate = rows.filter((r) => r.status !== 'unverified');
    const mentionRate = determinate.length
      ? Math.round((rows.filter((r) => r.status === 'mentioned').length / determinate.length) * 100)
      : null;

    const payload: Record<string, unknown> = {
      plan,
      scannedAt: new Date(scannedAt).toISOString(),
      nextScanAt: nextScanAt(new Date()).toISOString(),
      locations,
      mentionRate,
      engines,
      prompts,
    };

    if (isPro) {
      payload.history = await buildHistory(locationIds);
      payload.topCompetitors = topCompetitors(rows);
      payload.topSources = topSources(rows);
    }

    ok(res, payload);
  } catch (e) {
    next(e);
  }
}

/**
 * Week-over-week mention rate. Pro only.
 * Capped at the last 26 runs — half a year of a weekly scan, which is more
 * trend than any chart needs and keeps the payload bounded.
 */
async function buildHistory(locationIds: string[]): Promise<Array<{ scannedAt: string; mentionRate: number | null }>> {
  const rows = (await db('ai_visibility_snapshots')
    .whereIn('location_id', locationIds)
    .select('scanned_at')
    .count({ mentioned: db.raw("CASE WHEN status = 'mentioned' THEN 1 END") })
    .count({ determinate: db.raw("CASE WHEN status <> 'unverified' THEN 1 END") })
    .groupBy('scanned_at')
    .orderBy('scanned_at', 'desc')
    .limit(26)) as Array<{ scanned_at: Date; mentioned: string; determinate: string }>;

  return rows
    .map((r) => {
      const det = Number(r.determinate);
      return {
        scannedAt: new Date(r.scanned_at).toISOString(),
        mentionRate: det ? Math.round((Number(r.mentioned) / det) * 100) : null,
      };
    })
    .reverse();
}

/** Businesses the assistants named most often, excluding none — the client's own
 *  name appears here too and the UI marks it, which is the point of a ranking. */
function topCompetitors(rows: SnapshotRow[]): Array<{ name: string; timesNamed: number }> {
  const counts = new Map<string, { name: string; n: number }>();
  for (const r of rows) {
    for (const name of r.businesses_named ?? []) {
      const key = name.toLowerCase().trim();
      const cur = counts.get(key);
      if (cur) cur.n += 1;
      else counts.set(key, { name, n: 1 });
    }
  }
  return [...counts.values()]
    .sort((a, b) => b.n - a.n)
    .slice(0, 10)
    .map((c) => ({ name: c.name, timesNamed: c.n }));
}

/** Hostnames the assistants cited most often — the pages that decide local
 *  recommendations, several of which the customer can get listed on. */
function topSources(rows: SnapshotRow[]): Array<{ host: string; timesCited: number }> {
  const counts = new Map<string, number>();
  for (const r of rows) {
    for (const host of r.citations ?? []) {
      counts.set(host, (counts.get(host) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([host, timesCited]) => ({ host, timesCited }));
}

/**
 * The stored answer behind one verdict. Pro only (gated in planFeatures.ts).
 *
 * This is the evidence. A customer disputing "Gemini does not recommend you"
 * can read exactly what Gemini said, which is the difference between a claim and
 * a measurement.
 */
export async function answer(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = req.params;

    const row = (await db('ai_visibility_snapshots as s')
      .join('locations as l', 's.location_id', 'l.id')
      .where('s.id', id)
      // Scoped to the caller's own locations — an id from another client must
      // 404, not leak an answer.
      .where('l.client_id', req.clientId)
      .select(
        's.id',
        's.engine',
        's.model_name',
        's.prompt_text',
        's.status',
        's.position',
        's.unverified_reason',
        's.response_text',
        's.businesses_named',
        's.citations',
        's.scanned_at',
        'l.name as location_name',
      )
      .first()) as SnapshotRow & { response_text: string | null } | undefined;

    if (!row) {
      notFound(res, 'No such AI visibility result.');
      return;
    }

    ok(res, {
      id: row.id,
      engine: row.engine,
      label: aiEngineLabel(row.engine),
      modelName: row.model_name,
      promptText: row.prompt_text,
      status: row.status,
      position: row.position,
      unverifiedReason: friendlyReason(row.unverified_reason),
      responseText: row.response_text,
      businessesNamed: row.businesses_named ?? [],
      citations: row.citations ?? [],
      locationName: row.location_name,
      scannedAt: new Date(row.scanned_at).toISOString(),
    });
  } catch (e) {
    next(e);
  }
}
