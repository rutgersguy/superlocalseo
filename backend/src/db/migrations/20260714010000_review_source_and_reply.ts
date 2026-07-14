import { Knex } from 'knex';

/**
 * Phase 3 — publish replies to Google through EMR.
 *
 * `reviews.external_review_id` is ambiguous: for EMR-sourced rows it holds EMR's review id,
 * for GBP-sourced rows it holds Google's reviewId. Only an EMR id can be used with
 * `POST /api/v1/reviews/{id}/reply`, so we need to know where a review came from before we
 * try to reply to it. Record the source explicitly.
 *
 * Defaults to 'emr' because that is now the only live ingestion path — our own GBP sync is
 * inert (quota 0) and BrightLocal cannot post replies at all ("We don't support Review
 * Response via API", 2026-07-14). The table is empty at time of writing, so no backfill is
 * needed.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('reviews', (t) => {
    t.string('source', 20).notNullable().defaultTo('emr');
    t.index(['client_id', 'source']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('reviews', (t) => {
    t.dropIndex(['client_id', 'source']);
    t.dropColumn('source');
  });
}
