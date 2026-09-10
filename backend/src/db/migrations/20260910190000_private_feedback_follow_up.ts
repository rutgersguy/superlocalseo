import type { Knex } from 'knex';
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('private_feedback', t => {
    t.string('follow_up_status', 30).notNullable().defaultTo('new');
    t.uuid('assigned_user_id').nullable().references('id').inTable('users').onDelete('SET NULL');
    t.text('follow_up_notes').notNullable().defaultTo('');
    t.integer('follow_up_version').notNullable().defaultTo(0);
    t.timestamp('follow_up_updated_at').nullable();
    t.uuid('follow_up_updated_by').nullable().references('id').inTable('users').onDelete('SET NULL');
    t.index(['client_id', 'follow_up_status', 'received_at']);
  });
  await knex.raw("ALTER TABLE private_feedback ADD CONSTRAINT private_feedback_status_check CHECK (follow_up_status IN ('new','in_progress','resolved'))");
}
// Preserve follow-up notes and assignments if application code rolls back.
export async function down(): Promise<void> {}
