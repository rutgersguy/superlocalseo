import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('locations', (t) => {
    t.jsonb('service_area').defaultTo('[]').notNullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('locations', (t) => {
    t.dropColumn('service_area');
  });
}
