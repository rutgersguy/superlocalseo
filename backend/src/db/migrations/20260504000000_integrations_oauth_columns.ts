import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('integrations', (t) => {
    t.text('oauth_access_token').nullable();
    t.text('oauth_refresh_token').nullable();
    t.timestamp('oauth_expires_at').nullable();
    t.string('external_account_id', 255).nullable();
    t.string('external_account_name', 255).nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('integrations', (t) => {
    t.dropColumn('oauth_access_token');
    t.dropColumn('oauth_refresh_token');
    t.dropColumn('oauth_expires_at');
    t.dropColumn('external_account_id');
    t.dropColumn('external_account_name');
  });
}
