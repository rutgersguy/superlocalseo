import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('location_audits', (t) => {
    t.string('dfs_on_page_task_id', 255).nullable();
    t.jsonb('dfs_on_page_data').nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('location_audits', (t) => {
    t.dropColumn('dfs_on_page_task_id');
    t.dropColumn('dfs_on_page_data');
  });
}
