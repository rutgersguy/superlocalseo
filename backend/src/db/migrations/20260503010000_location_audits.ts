import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('location_audits', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('client_id').notNullable().references('id').inTable('clients').onDelete('CASCADE');
    t.uuid('location_id').notNullable().references('id').inTable('locations').onDelete('CASCADE');
    t.string('bl_report_id', 255).nullable();
    t.string('status', 50).notNullable().defaultTo('pending');
    t.decimal('nap_score', 5, 2).nullable();
    t.decimal('citation_score', 5, 2).nullable();
    t.decimal('review_score', 5, 2).nullable();
    t.decimal('google_score', 5, 2).nullable();
    t.decimal('composite_score', 5, 2).nullable();
    t.jsonb('raw_data').nullable();
    t.jsonb('recommendations').nullable();
    t.timestamp('completed_at').nullable();
    t.timestamps(true, true);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('location_audits');
}
