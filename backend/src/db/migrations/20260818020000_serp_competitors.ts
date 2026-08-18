import { Knex } from 'knex';

/**
 * Automatic competitor discovery from SERP results (#81).
 *
 * WHY A NEW TABLE RATHER THAN `competitor_rankings`
 * -------------------------------------------------
 * `competitor_rankings` tracks businesses a client has explicitly NAMED — it is
 * keyed on `competitor_id` and cannot represent a business nobody has added.
 * That is the wrong shape for the question this answers: "who is beating me?"
 * has to work before you know who to name, and the whole value is discovering
 * competitors the client had not thought of.
 *
 * So this stores every result on the page, keyed on domain/name rather than on a
 * row in `competitors`. The two coexist: named competitors keep their curated
 * history, and this is the unfiltered record.
 *
 * COST: none. The ranking job already requests depth 30 for every keyword and
 * discarded everything except the client and named competitors. This keeps what
 * we were already paying for.
 *
 * VOLUME: keywords × geos × ~30 results × daily. A client with 20 keywords and
 * 3 geos writes ~1,800 rows a day, so `pulled_at` is indexed for the retention
 * sweep this will eventually need. Not partitioned — at current client numbers
 * that would be premature.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('serp_competitors', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('keyword_id').notNullable().references('id').inTable('keywords').onDelete('CASCADE');
    t.uuid('location_id').notNullable().references('id').inTable('locations').onDelete('CASCADE');

    t.integer('position').notNullable();
    t.string('rank_type', 20).notNullable().defaultTo('organic');
    // Nullable because local-pack entries frequently carry no website at all —
    // for those the business name is the only identity available.
    t.string('domain', 255).nullable();
    t.string('business_name', 255).nullable();
    t.text('url').nullable();

    t.string('geo_location', 120).nullable();
    t.timestamp('pulled_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    t.index(['location_id', 'pulled_at'], 'serp_competitors_location_pulled_index');
    t.index(['keyword_id', 'pulled_at'], 'serp_competitors_keyword_pulled_index');
    t.index(['domain'], 'serp_competitors_domain_index');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('serp_competitors');
}
