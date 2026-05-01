import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('competitors', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('client_id').notNullable().references('id').inTable('clients').onDelete('CASCADE');
    t.string('name', 255).notNullable();
    t.string('website', 500).nullable();
    t.string('google_place_id', 255).nullable();
    t.decimal('google_rating', 2, 1).nullable();
    t.integer('google_review_count').nullable();
    t.timestamp('last_synced_at').nullable();
    t.timestamps(true, true);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('competitors');
}
