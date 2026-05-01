import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('geo_grid_reports', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('client_id').notNullable().references('id').inTable('clients').onDelete('CASCADE');
    t.uuid('location_id').notNullable().references('id').inTable('locations').onDelete('CASCADE');
    t.uuid('keyword_id').notNullable().references('id').inTable('keywords').onDelete('CASCADE');
    t.string('bl_report_id', 255).nullable();
    t.string('status', 50).notNullable().defaultTo('pending');
    t.integer('grid_size').notNullable().defaultTo(7);
    t.decimal('center_lat', 10, 7).nullable();
    t.decimal('center_lng', 10, 7).nullable();
    t.jsonb('grid_data').nullable();
    t.timestamp('completed_at').nullable();
    t.timestamps(true, true);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('geo_grid_reports');
}
