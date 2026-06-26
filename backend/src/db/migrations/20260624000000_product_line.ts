import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('clients', (t) => {
    // Default 'pro' so all existing clients are unaffected (zero disruption)
    t.string('product_line', 20).notNullable().defaultTo('pro');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('clients', (t) => {
    t.dropColumn('product_line');
  });
}
