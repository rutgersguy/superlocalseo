import type { Knex } from 'knex';
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('review_collection_links', t => {
    t.uuid('location_id').primary().references('id').inTable('locations').onDelete('CASCADE');
    t.uuid('client_id').notNullable().references('id').inTable('clients').onDelete('CASCADE');
    t.string('token', 64).notNullable().unique();
    t.integer('mapping_revision').notNullable();
    t.string('identity', 64).notNullable();
    t.timestamp('revoked_at').nullable();
    t.timestamps(true, true);
  });
  await knex.schema.alterTable('private_feedback', t => {
    t.string('source', 30).notNullable().defaultTo('emr');
    t.boolean('contact_consent').notNullable().defaultTo(false);
    t.uuid('submission_id').nullable();
    t.string('submission_hash', 64).nullable();
    t.unique(['location_id', 'submission_id']);
  });
}
// Retain issued links and feedback if application code is rolled back.
export async function down(): Promise<void> {}
