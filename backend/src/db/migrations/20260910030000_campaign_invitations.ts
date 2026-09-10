import type { Knex } from 'knex';
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('emr_campaigns', t => { t.boolean('statistics_checked').notNullable().defaultTo(false); });
  await knex.schema.createTable('campaign_invite_batches', t => {
    t.uuid('id').primary();
    t.uuid('client_id').notNullable().references('id').inTable('clients').onDelete('CASCADE');
    t.uuid('request_id').notNullable(); t.string('payload_hash',64).notNullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now()); t.unique(['client_id','request_id']);
  });
  await knex.schema.createTable('campaign_invitation_attempts', t => {
    t.uuid('id').primary(); t.uuid('batch_id').notNullable().references('id').inTable('campaign_invite_batches').onDelete('CASCADE');
    t.uuid('client_id').notNullable().references('id').inTable('clients').onDelete('CASCADE');
    t.uuid('location_id').nullable().references('id').inTable('locations').onDelete('SET NULL');
    t.uuid('actor_id').nullable().references('id').inTable('users').onDelete('SET NULL');
    t.string('campaign_id',255).notNullable(); t.string('campaign_name',255).notNullable();
    t.integer('contact_index').notNullable(); t.string('email_hash',64).nullable(); t.string('phone_hash',64).nullable();
    t.string('recipient_hint',400).notNullable(); t.string('status',30).notNullable();
    t.string('provider_reference',255).nullable(); t.integer('provider_status').nullable();
    t.text('detail').nullable(); t.jsonb('provider_route').notNullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now()); t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    t.unique(['batch_id','contact_index']); t.index(['client_id','campaign_id']);
  });
}
export async function down(): Promise<void> {}
