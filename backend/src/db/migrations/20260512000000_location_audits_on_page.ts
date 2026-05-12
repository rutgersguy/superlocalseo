import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('location_audits', (t) => {
    t.integer('on_page_score').nullable();
    t.jsonb('on_page_details').nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('location_audits', (t) => {
    t.dropColumn('on_page_score');
    t.dropColumn('on_page_details');
  });
}
