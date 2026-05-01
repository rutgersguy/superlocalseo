import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('clients', (t) => {
    t.timestamp('trial_ends_at').nullable();
  });
  // Back-fill existing rows: 14 days from account creation
  await knex.raw(`UPDATE clients SET trial_ends_at = created_at + INTERVAL '14 days' WHERE trial_ends_at IS NULL`);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('clients', (t) => {
    t.dropColumn('trial_ends_at');
  });
}
