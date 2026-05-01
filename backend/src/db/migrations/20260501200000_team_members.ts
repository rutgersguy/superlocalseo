import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('team_members', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('client_id').notNullable().references('id').inTable('clients').onDelete('CASCADE');
    t.uuid('user_id').nullable().references('id').inTable('users').onDelete('CASCADE');
    t.string('email', 255).notNullable();
    t.string('role', 50).notNullable().defaultTo('viewer');  // 'admin' | 'viewer'
    t.uuid('invited_by').nullable().references('id').inTable('users').onDelete('SET NULL');
    t.string('invite_token', 255).nullable().unique();
    t.timestamp('invite_expires_at').nullable();
    t.timestamp('accepted_at').nullable();
    t.timestamps(true, true);
  });
  await knex.raw('CREATE UNIQUE INDEX idx_team_members_client_user ON team_members (client_id, user_id) WHERE user_id IS NOT NULL');
  await knex.raw('CREATE INDEX idx_team_members_token ON team_members (invite_token)');
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('team_members');
}
