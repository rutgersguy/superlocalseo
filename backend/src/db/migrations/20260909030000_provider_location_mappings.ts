import { Knex } from 'knex';

// Deliberately no legacy backfill: client-wide IDs do not prove branch identity.
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('locations', t => { t.unique(['id', 'client_id'], { indexName: 'locations_id_client_unique' }); });
  await knex.schema.createTable('provider_organization_owners', t => {
    t.string('organization_id', 30).primary();
    t.uuid('client_id').notNullable().references('id').inTable('clients').onDelete('CASCADE');
    t.unique(['organization_id', 'client_id']);
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
  await knex.schema.createTable('provider_location_mappings', t => {
    t.uuid('location_id').primary();
    t.uuid('client_id').notNullable();
    t.string('organization_id', 30).notNullable();
    t.string('provider_location_id', 30).notNullable().unique();
    t.string('google_place_id', 255).notNullable();
    t.integer('revision').notNullable();
    t.jsonb('evidence').notNullable();
    t.text('note').notNullable();
    t.timestamp('verified_at', { useTz: true }).notNullable();
    t.foreign(['location_id', 'client_id']).references(['id', 'client_id']).inTable('locations').onDelete('CASCADE');
    t.foreign(['organization_id', 'client_id']).references(['organization_id', 'client_id']).inTable('provider_organization_owners');
  });
  await knex.schema.createTable('provider_mapping_events', t => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    // Keep historical identity even if a location or customer is later deleted.
    t.uuid('location_id').notNullable();
    t.uuid('client_id').notNullable();
    t.uuid('actor_id').nullable().references('id').inTable('users').onDelete('SET NULL');
    t.integer('revision').notNullable();
    t.text('note').notNullable();
    t.jsonb('evidence').notNullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.unique(['location_id', 'revision']);
  });
}
// Preserve operator evidence when rolling application code back.
export async function down(_knex: Knex): Promise<void> {}
