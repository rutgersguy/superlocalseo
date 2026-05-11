import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('locations', (t) => {
    // BrightLocal integer location ID (from their Management API).
    // Required to create Citation Builder campaigns via POST /manage/v1/citation-builder.
    // Distinct from brightlocal_campaign_id (legacy v4 API campaign UUID).
    t.integer('brightlocal_location_id').nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('locations', (t) => {
    t.dropColumn('brightlocal_location_id');
  });
}
