import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('clients', (t) => {
    t.text('emr_password_encrypted').nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('clients', (t) => {
    t.dropColumn('emr_password_encrypted');
  });
}
