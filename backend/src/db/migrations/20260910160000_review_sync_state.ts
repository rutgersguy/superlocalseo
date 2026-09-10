import type { Knex } from 'knex';
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('review_sync_state', t => {
    t.uuid('client_id').notNullable().references('id').inTable('clients').onDelete('CASCADE');
    t.string('provider_location_id', 30).notNullable();
    t.uuid('generation').notNullable();
    t.jsonb('route').notNullable();
    t.timestamp('started_at').notNullable();
    t.timestamp('completed_at').nullable();
    t.timestamp('last_success_at').nullable();
    t.integer('last_source_count').nullable();
    t.string('status', 20).notNullable();
    t.primary(['client_id', 'provider_location_id']);
  });
}
export async function down(): Promise<void> {}
