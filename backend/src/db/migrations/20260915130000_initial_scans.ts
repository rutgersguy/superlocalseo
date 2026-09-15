import { Knex } from 'knex';
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('initial_scans', t => {
    t.uuid('location_id').references('id').inTable('locations').onDelete('CASCADE');
    t.uuid('client_id').notNullable().references('id').inTable('clients').onDelete('CASCADE');
    t.string('step', 32).notNullable();
    t.string('status', 32).notNullable().defaultTo('waiting');
    t.string('reason', 255).nullable();
    t.timestamp('started_at', { useTz: true }).nullable();
    t.timestamp('completed_at', { useTz: true }).nullable();
    t.timestamps(true, true);
    t.primary(['location_id', 'step']);
    t.index(['status']);
  });
}
export async function down(_knex: Knex): Promise<void> { /* Preserve scan attempt history. */ }
