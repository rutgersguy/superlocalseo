import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // Per-client ROI settings
  await knex.schema.alterTable('clients', (t) => {
    t.jsonb('roi_config').nullable();
  });

  // Monthly search volume per keyword (client-entered estimate)
  await knex.schema.alterTable('keywords', (t) => {
    t.integer('monthly_search_volume').nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('clients', (t) => {
    t.dropColumn('roi_config');
  });
  await knex.schema.alterTable('keywords', (t) => {
    t.dropColumn('monthly_search_volume');
  });
}
