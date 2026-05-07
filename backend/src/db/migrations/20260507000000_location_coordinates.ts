import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('locations', (t) => {
    t.decimal('lat', 10, 7).nullable();
    t.decimal('lng', 10, 7).nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('locations', (t) => {
    t.dropColumn('lat');
    t.dropColumn('lng');
  });
}
