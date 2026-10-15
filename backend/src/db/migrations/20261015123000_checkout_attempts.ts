import { Knex } from 'knex';
export async function up(knex: Knex): Promise<void> { await knex.schema.alterTable('clients', t => t.jsonb('pending_checkout').nullable()); }
export async function down(knex: Knex): Promise<void> { await knex.schema.alterTable('clients', t => t.dropColumn('pending_checkout')); }
