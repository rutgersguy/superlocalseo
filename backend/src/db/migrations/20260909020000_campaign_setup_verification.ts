import { Knex } from 'knex';
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('campaign_setup_requests', t => {
    t.string('status', 30).notNullable().defaultTo('requested');
    t.integer('revision').notNullable().defaultTo(0);
    t.jsonb('verification').nullable();
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
  await knex.schema.createTable('campaign_setup_events', t => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('request_id').notNullable().references('id').inTable('campaign_setup_requests').onDelete('CASCADE');
    t.uuid('actor_id').nullable().references('id').inTable('users').onDelete('SET NULL');
    t.integer('revision').notNullable();
    t.string('status', 30).notNullable();
    t.text('note').notNullable();
    t.jsonb('verification').nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.unique(['request_id', 'revision']);
  });
}
// Preserve operator evidence when application code is rolled back.
export async function down(_knex: Knex): Promise<void> {}
