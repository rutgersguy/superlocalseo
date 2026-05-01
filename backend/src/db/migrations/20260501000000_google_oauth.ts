import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('users', (t) => {
    t.string('google_id', 255).nullable();
  });
  await knex.raw('ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL');
  await knex.raw('ALTER TABLE users ADD CONSTRAINT users_google_id_unique UNIQUE (google_id)');
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('users', (t) => {
    t.dropColumn('google_id');
  });
  await knex.raw('ALTER TABLE users ALTER COLUMN password_hash SET NOT NULL');
}
