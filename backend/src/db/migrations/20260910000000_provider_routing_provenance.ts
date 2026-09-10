import { Knex } from 'knex';
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('reviews', t => { t.string('emr_provider_location_id', 30).nullable(); });
  await knex.schema.alterTable('private_feedback', t => { t.uuid('location_id').nullable().references('id').inTable('locations').onDelete('SET NULL'); });
  await knex.schema.alterTable('emr_campaigns', t => { t.string('emr_organization_id', 30).nullable(); });
  await knex.schema.alterTable('provider_location_mappings', t => { t.timestamp('last_review_sync_at', { useTz: true }).nullable(); t.text('review_sync_error').nullable(); });
}
export async function down(_knex: Knex): Promise<void> {}
