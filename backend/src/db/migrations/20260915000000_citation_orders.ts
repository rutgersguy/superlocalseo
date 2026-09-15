import type { Knex } from 'knex';
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('citation_orders', t => {
    t.uuid('location_id').primary().references('id').inTable('locations').onDelete('RESTRICT');
    t.uuid('client_id').notNullable().references('id').inTable('clients').onDelete('RESTRICT');
    t.string('campaign_id').notNullable().unique();
    t.string('status').notNullable();
    t.integer('credits_reserved').notNullable();
    t.string('invoice_id').notNullable();
    t.jsonb('directories').notNullable();
    t.timestamps(true, true);
  });
}
// Financial intent must survive application rollbacks.
export async function down(): Promise<void> {}
