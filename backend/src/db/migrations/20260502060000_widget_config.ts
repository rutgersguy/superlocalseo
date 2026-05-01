import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('client_widgets', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('client_id').notNullable().references('id').inTable('clients').onDelete('CASCADE');
    t.jsonb('config').nullable();
    t.timestamps(true, true);
  });

  await knex.raw(`
    INSERT INTO client_widgets (client_id, config, created_at, updated_at)
    SELECT id, '{}', NOW(), NOW()
    FROM clients
    WHERE id IS NOT NULL
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('client_widgets');
}
