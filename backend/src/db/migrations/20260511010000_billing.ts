import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('clients', (t) => {
    t.integer('locations_limit').notNullable().defaultTo(1);
  });

  // Backfill trial_ends_at for clients that don't have it set
  await knex('clients')
    .whereNull('trial_ends_at')
    .update({ trial_ends_at: knex.raw("NOW() + INTERVAL '15 days'") });

  // Admin users (role = admin on users) get unlimited locations
  await knex('clients')
    .whereIn('user_id', knex('users').where({ role: 'admin' }).select('id'))
    .update({ locations_limit: 999, subscription_status: 'active' });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('clients', (t) => {
    t.dropColumn('locations_limit');
  });
}
