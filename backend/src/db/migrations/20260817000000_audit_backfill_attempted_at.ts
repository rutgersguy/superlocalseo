import { Knex } from 'knex';

/**
 * Stops the audit backfills from re-processing the same rows forever (issue #158).
 *
 * `pollPending()` runs every 5 minutes and contains two backfills that select on
 * the ABSENCE of a value and then write whatever `computeAuditScores()` returns:
 *
 *   on_page_score  IS NULL  -> compute -> write on_page_score
 *   composite_score IS NULL -> compute -> write composite_score
 *
 * When the computation legitimately yields null — the site is unreachable, the
 * Lighthouse task returned nothing — the row is written back unchanged and
 * therefore re-qualifies on the next tick. Forever.
 *
 * Observed in production: two already-`complete` audits logging
 * "On-page backfill complete, score: null" every 5 minutes since 2026-08-01 —
 * roughly 4,300 no-op runs, burying real signal in the logs.
 *
 * A nullable timestamp is enough: record that we tried, skip rows tried recently,
 * and still allow a retry later in case the upstream recovers.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('location_audits', (t) => {
    t.timestamp('backfill_attempted_at', { useTz: true }).nullable();
  });

  // Existing rows have been retried thousands of times already. Stamp the ones
  // that are currently looping so they stop immediately rather than waiting out
  // a retry window from a null baseline.
  await knex('location_audits')
    .where({ status: 'complete' })
    .whereNull('on_page_score')
    .update({ backfill_attempted_at: knex.fn.now() });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('location_audits', (t) => {
    t.dropColumn('backfill_attempted_at');
  });
}
