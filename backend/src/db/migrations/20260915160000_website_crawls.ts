import type { Knex } from 'knex';
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('location_audits', t => {
    t.string('crawl_status').nullable();
    t.string('crawl_task_id').nullable();
    t.text('crawl_url').nullable();
    t.jsonb('crawl_data').nullable();
    t.timestamp('crawl_started_at', { useTz: true }).nullable();
    t.index(['crawl_status']);
  });
  // Only newly created audits queue a crawl. Do not repurchase historical audits.
  await knex.raw("ALTER TABLE location_audits ALTER COLUMN crawl_status SET DEFAULT 'queued'");
}
export async function down(): Promise<void> { /* Preserve paid task identity. */ }
