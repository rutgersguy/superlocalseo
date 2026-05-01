import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('locations', (t) => {
    t.string('google_place_id', 255).nullable();
  });

  await knex.schema.createTable('qr_codes', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('client_id').notNullable().references('id').inTable('clients').onDelete('CASCADE');
    t.uuid('location_id').nullable().references('id').inTable('locations').onDelete('SET NULL');
    t.string('name', 255).notNullable();
    t.text('target_url').notNullable();
    t.string('short_code', 12).notNullable().unique();
    t.integer('scan_count').notNullable().defaultTo(0);
    t.timestamp('last_scanned_at').nullable();
    t.timestamps(true, true);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('qr_codes');
  await knex.schema.alterTable('locations', (t) => {
    t.dropColumn('google_place_id');
  });
}
