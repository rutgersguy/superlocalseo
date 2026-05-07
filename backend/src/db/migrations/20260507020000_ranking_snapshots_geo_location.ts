import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('ranking_snapshots', (t) => {
    t.text('geo_location').nullable(); // null = primary city; set for service-area city checks
  });
  // Update the trend index to include geo_location
  await knex.raw('DROP INDEX IF EXISTS idx_ranking_snapshots_trend');
  await knex.raw('CREATE INDEX idx_ranking_snapshots_trend ON ranking_snapshots (keyword_id, location_id, geo_location, pulled_at DESC)');
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('DROP INDEX IF EXISTS idx_ranking_snapshots_trend');
  await knex.raw('CREATE INDEX idx_ranking_snapshots_trend ON ranking_snapshots (keyword_id, location_id, pulled_at DESC)');
  await knex.schema.alterTable('ranking_snapshots', (t) => {
    t.dropColumn('geo_location');
  });
}
