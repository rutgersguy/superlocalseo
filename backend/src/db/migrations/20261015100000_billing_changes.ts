import { Knex } from 'knex';
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('billing_changes', t => {
    t.uuid('id').primary();
    t.uuid('client_id').notNullable().references('id').inTable('clients').onDelete('CASCADE');
    t.string('subscription_id').notNullable();
    t.string('status').notNullable().defaultTo('quoted');
    t.jsonb('quote').notNullable();
    t.string('setup_intent_id');
    t.string('invoice_id');
    t.timestamp('expires_at').notNullable();
    t.timestamp('confirmed_at');
    t.timestamps(true, true);
    t.index(['client_id', 'status']);
  });
}
export async function down(knex: Knex): Promise<void> { await knex.schema.dropTable('billing_changes'); }
