import { Knex } from 'knex';

/**
 * EMR multi-tenancy fix (phase 1).
 *
 * Every client's `integrations` row stored the SHARED agency operator key, so reviews.job
 * called fetchAllReviews() with the same key for every client and pulled the agency org's
 * reviews for all of them. The per-client EMR sub-accounts we provision were never read
 * from. Nothing surfaced because no Google profile is connected yet and the review set is
 * empty — the first connection would have fed every client the same reviews.
 *
 * Per-customer API tokens are NOT an option: EMR can only mint tokens in its dashboard, and
 * an agency token cannot scope a query to a customer's data. The model their API actually
 * supports is one LOCATION per client inside our own organization — `connect-links` takes a
 * `location_id`, and `GET /reviews` filters by `location_id`. So we scope by location.
 *
 * Also widens the reviews unique key. It was UNIQUE(platform, external_review_id) — GLOBAL,
 * not per client — so two clients could never hold the same external review: the second
 * insert would merge into the first client's row. Scope it by client_id.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('clients', (t) => {
    t.integer('emr_organization_id').nullable();
    t.integer('emr_location_id').nullable();
    t.unique(['emr_location_id']);
  });

  await knex.schema.alterTable('reviews', (t) => {
    t.dropUnique(['platform', 'external_review_id']);
    t.unique(['client_id', 'platform', 'external_review_id']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('reviews', (t) => {
    t.dropUnique(['client_id', 'platform', 'external_review_id']);
    t.unique(['platform', 'external_review_id']);
  });

  await knex.schema.alterTable('clients', (t) => {
    t.dropUnique(['emr_location_id']);
    t.dropColumn('emr_location_id');
    t.dropColumn('emr_organization_id');
  });
}
