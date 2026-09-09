import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('campaign_setup_requests', t => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('client_id').notNullable().references('id').inTable('clients').onDelete('CASCADE');
    t.uuid('location_id').notNullable().references('id').inTable('locations').onDelete('CASCADE');
    t.uuid('requested_by').nullable().references('id').inTable('users').onDelete('SET NULL');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.unique(['client_id', 'location_id']);
  });
}
export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTable('campaign_setup_requests');
}
