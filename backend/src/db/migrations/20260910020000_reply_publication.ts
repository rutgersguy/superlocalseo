import type { Knex } from 'knex';
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('review_responses', t => {
    t.timestamp('publishing_started_at').nullable();
    t.timestamp('reconcile_checked_at').nullable();
    t.text('last_publish_error').nullable();
    t.jsonb('publish_route').nullable();
  });
}
// Retain publication evidence on rollback. Never replay pending public writes.
export async function down(): Promise<void> {}
