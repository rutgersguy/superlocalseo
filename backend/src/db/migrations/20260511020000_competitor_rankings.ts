import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('competitor_rankings', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('competitor_id').notNullable().references('id').inTable('competitors').onDelete('CASCADE');
    t.uuid('keyword_id').notNullable().references('id').inTable('keywords').onDelete('CASCADE');
    t.uuid('location_id').notNullable().references('id').inTable('locations').onDelete('CASCADE');
    t.integer('rank').nullable();
    t.string('url', 500).nullable();
    t.string('search_engine', 50).notNullable().defaultTo('google');
    t.timestamp('pulled_at').notNullable().defaultTo(knex.fn.now());
    t.timestamps(true, true);
  });

  await knex.raw(`
    CREATE INDEX competitor_rankings_lookup_idx
    ON competitor_rankings (competitor_id, keyword_id, location_id, pulled_at DESC)
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('competitor_rankings');
}
