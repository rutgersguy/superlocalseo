import { Knex } from 'knex';
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('billing_effects', t => {
    t.string('id').primary(); t.string('kind').notNullable(); t.jsonb('payload').notNullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('attempted_at'); t.timestamp('completed_at'); t.text('error');
  });
}
export async function down(knex: Knex): Promise<void> { await knex.schema.dropTable('billing_effects'); }
