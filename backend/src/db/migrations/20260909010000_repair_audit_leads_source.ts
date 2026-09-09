import type { Knex } from 'knex';

// Production had the original source migration recorded, but the column itself
// was absent. Reconcile that drift without rewriting history or touching leads.
export async function up(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasColumn('audit_leads', 'source'))) {
    await knex.schema.alterTable('audit_leads', table => {
      table.string('source', 100).nullable().defaultTo(null);
    });
  }
}

// source belongs to an earlier migration and may contain newly collected leads.
// Reverting this repair must not remove that column or its data.
export async function down(_knex: Knex): Promise<void> {}
