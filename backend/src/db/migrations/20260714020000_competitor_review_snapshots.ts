import { Knex } from 'knex';

/**
 * History of competitors' Google review counts and ratings.
 *
 * `competitors.google_rating` / `google_review_count` hold only the CURRENT values — every
 * sync overwrites them — so we can say what a competitor's rating is, but not what it did.
 * That makes the most useful sentence we could put in front of a customer impossible:
 *
 *   "You dropped from #3 to #7. Your competitor gained 18 reviews this month."
 *
 * The rank half of that already works (`ranking_snapshots` / `competitor_rankings`); the
 * review half needs history. This table is that half — the input to Next Best Actions.
 *
 * One row per competitor per day: the daily job and a manual re-sync can both fire on the same
 * day, and the last write should win rather than create duplicates.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('competitor_review_snapshots', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('competitor_id').notNullable().references('id').inTable('competitors').onDelete('CASCADE');
    // Denormalized so "all competitor history for this client" is one indexed scan.
    t.uuid('client_id').notNullable().references('id').inTable('clients').onDelete('CASCADE');
    t.decimal('google_rating', 2, 1).nullable();
    t.integer('google_review_count').nullable();
    t.date('captured_on').notNullable();
    t.timestamp('captured_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    t.unique(['competitor_id', 'captured_on']);
    t.index(['client_id', 'captured_on']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('competitor_review_snapshots');
}
