import { Knex } from 'knex';
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('locations', t => { t.timestamp('archived_at').nullable().index(); });
  await knex.raw('CREATE VIEW active_locations AS SELECT * FROM locations WHERE archived_at IS NULL');
  await knex.schema.createTable('stripe_webhook_events', t => { t.string('id').primary(); t.string('type').notNullable(); t.timestamp('processed_at').notNullable().defaultTo(knex.fn.now()); });
}
export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTable('stripe_webhook_events');
  await knex.raw('DROP VIEW active_locations');
  await knex.schema.alterTable('locations', t => { t.dropColumn('archived_at'); });
}
