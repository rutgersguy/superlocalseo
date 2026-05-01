import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('ranking_snapshots', (t) => {
    t.string('rank_type', 20).notNullable().defaultTo('organic');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('ranking_snapshots', (t) => {
    t.dropColumn('rank_type');
  });
}
