import { Job } from 'bullmq';
import { db } from '../db/connection';
import { ENABLED_AI_ENGINES, AI_PROMPTS, buildPrompt } from '../config/ai_engines.config';
import { checkVisibility, AiVisibilityCheck } from '../services/ai_visibility.service';
import { logger } from '../utils/logger';

/**
 * Weekly AI assistant visibility scan.
 *
 * CADENCE
 * -------
 * Weekly, Monday 08:00 UTC — an hour after the citation scan so the two do not
 * contend for the same DataForSEO rate limit. Assistant answers are driven by
 * search results and review corpora that move on the order of weeks, so a daily
 * scan would buy noise at seven times the cost.
 *
 * SEQUENTIAL, NOT PARALLEL
 * ------------------------
 * Requests run one at a time. Concurrency against DataForSEO is what produced
 * the my_business_info incident (#174), where 12 parallel calls returned one
 * success and eleven throttles-as-HTTP-200 — which a naive reader records as
 * eleven customers having no listing. `dfsPost` retries those, but not creating
 * the burst is better than recovering from it, and a location's 12 calls take
 * about a minute, which no one is waiting on.
 *
 * FAILURE POLICY
 * --------------
 * `checkVisibility` never throws; a dead engine becomes an `unverified` row. So
 * this job's own failure test is different from the citation job's: rows always
 * get written, and the question is whether ANY of them carry a real verdict.
 * A location whose every check came back unverified is an outage for that
 * location, and a run where that is true of every location must fail loudly
 * rather than resolve — the #149 lesson, where a job reported success daily for
 * three months while writing nothing usable.
 */
interface LocationRow {
  locationId: string;
  clientId: string;
  name: string;
  city: string | null;
  state: string | null;
  industry: string | null;
}

export async function processAiVisibility(job: Job): Promise<void> {
  const clientId: string | undefined = job.data?.clientId;

  let q = db('locations')
    .join('clients', 'locations.client_id', 'clients.id')
    .whereNotIn('clients.subscription_status', ['canceled', 'past_due'])
    .select(
      'locations.id as locationId',
      'locations.client_id as clientId',
      'locations.name as name',
      'locations.city as city',
      'locations.state as state',
      'clients.industry as industry',
    );

  if (clientId) q = q.where('locations.client_id', clientId);

  const locations = (await q) as LocationRow[];
  logger.info(`AI visibility job: ${locations.length} locations`, {
    engines: ENABLED_AI_ENGINES.map((e) => e.key),
    prompts: AI_PROMPTS.length,
  });

  let scanned = 0;
  let blankLocations = 0;
  let lastError: string | null = null;

  for (const loc of locations) {
    try {
      const determined = await scanLocation(loc);
      scanned += 1;
      if (!determined) {
        blankLocations += 1;
        lastError = `every check unverified for location ${loc.locationId}`;
        logger.warn('AI visibility: no determinate result', { locationId: loc.locationId });
      }
    } catch (e) {
      blankLocations += 1;
      lastError = (e as Error).message;
      logger.warn('AI visibility scan failed', { locationId: loc.locationId, error: lastError });
    }
  }

  if (locations.length > 0 && blankLocations === locations.length) {
    throw new Error(
      `AI visibility produced no determinate result for any of ${locations.length} location(s). Last error: ${lastError}`,
    );
  }

  logger.info('AI visibility job complete', {
    locations: locations.length,
    scanned,
    blankLocations,
  });
}

/** Returns true when at least one check for this location reached a real verdict. */
async function scanLocation(loc: LocationRow): Promise<boolean> {
  // No city means no local question to ask — a place-less prompt returns a
  // national answer, and recording "not mentioned" against that would be a
  // fabricated negative. Skipped, not scanned, and never written.
  const prompts = AI_PROMPTS
    .map((p) => ({ key: p.key, text: buildPrompt(p, { industry: loc.industry, city: loc.city, state: loc.state }) }))
    .filter((p): p is { key: string; text: string } => p.text !== null);

  if (prompts.length === 0) {
    logger.info('AI visibility: skipping location with no city', { locationId: loc.locationId });
    return true; // not a failure — there is nothing to ask
  }

  const checks: AiVisibilityCheck[] = [];

  for (const prompt of prompts) {
    for (const engine of ENABLED_AI_ENGINES) {
      checks.push(
        await checkVisibility({
          engine: engine.key,
          modelName: engine.modelName,
          promptKey: prompt.key,
          promptText: prompt.text,
          businessName: loc.name,
          industry: loc.industry,
          city: loc.city,
          state: loc.state,
        }),
      );
    }
  }

  const now = new Date();
  await db('ai_visibility_snapshots').insert(
    checks.map((c) => ({
      location_id: loc.locationId,
      prompt_key: c.promptKey,
      prompt_text: c.promptText,
      engine: c.engine,
      model_name: c.modelName,
      status: c.status,
      unverified_reason: c.unverifiedReason,
      position: c.position,
      businesses_named: JSON.stringify(c.businessesNamed),
      citations: JSON.stringify(c.citations),
      response_text: c.responseText,
      input_tokens: c.inputTokens,
      output_tokens: c.outputTokens,
      cost_usd: c.costUsd,
      scanned_at: now,
    })),
  );

  const mentioned = checks.filter((c) => c.status === 'mentioned').length;
  const absent = checks.filter((c) => c.status === 'absent').length;
  const unverified = checks.filter((c) => c.status === 'unverified').length;
  const cost = checks.reduce((sum, c) => sum + c.costUsd, 0);

  logger.info('AI visibility scan complete', {
    locationId: loc.locationId,
    checks: checks.length,
    mentioned,
    absent,
    unverified,
    costUsd: Number(cost.toFixed(4)),
  });

  return mentioned + absent > 0;
}
