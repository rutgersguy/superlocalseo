import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('audit_leads', (t) => {
    t.string('source', 100).nullable().defaultTo(null);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('audit_leads', (t) => {
    t.dropColumn('source');
  });
}
