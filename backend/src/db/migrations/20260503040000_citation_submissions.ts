import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('citation_submissions', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('client_id').notNullable().references('id').inTable('clients').onDelete('CASCADE');
    t.uuid('location_id').notNullable().references('id').inTable('locations').onDelete('CASCADE');
    t.string('directory', 100).notNullable();
    t.string('status', 50).notNullable().defaultTo('pending');
    t.string('bl_submission_id', 255).nullable();
    t.string('listing_url', 2000).nullable();
    t.text('rejection_reason').nullable();
    t.timestamp('submitted_at').nullable();
    t.timestamp('live_at').nullable();
    t.timestamps(true, true);
    t.unique(['location_id', 'directory']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('citation_submissions');
}
