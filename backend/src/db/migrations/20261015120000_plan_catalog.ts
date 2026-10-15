import { Knex } from 'knex';
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('clients', t => {
    t.string('plan_key').nullable();
    t.string('pricing_version').notNullable().defaultTo('legacy');
    t.string('billing_interval').notNullable().defaultTo('month');
  });
  // Existing accounts retain their exact billing state; new registrations explicitly opt in.
  await knex.schema.createTable('plan_usage', t => {
    t.uuid('client_id').references('id').inTable('clients').onDelete('CASCADE');
    t.string('scope').notNullable();
    t.string('metric').notNullable();
    t.string('period').notNullable();
    t.integer('used').notNullable().defaultTo(0);
    t.primary(['client_id', 'scope', 'metric', 'period']);
  });
}
export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTable('plan_usage');
  await knex.schema.alterTable('clients', t => { t.dropColumn('plan_key'); t.dropColumn('pricing_version'); t.dropColumn('billing_interval'); });
}
