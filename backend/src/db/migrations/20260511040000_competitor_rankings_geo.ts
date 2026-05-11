import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('competitor_rankings', (t) => {
    t.string('geo_location', 255).nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('competitor_rankings', (t) => {
    t.dropColumn('geo_location');
  });
}
