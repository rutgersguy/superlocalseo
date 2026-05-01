import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('clients', (t) => {
    t.uuid('widget_key').nullable().unique();
    t.jsonb('widget_config').nullable();
  });

  // Generate a widget_key for every existing client
  await knex.raw(`
    UPDATE clients
    SET widget_key = gen_random_uuid(),
        widget_config = '{"theme":"light","minRating":4,"maxCount":8,"showPlatformBadge":true}'::jsonb
    WHERE widget_key IS NULL
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('clients', (t) => {
    t.dropColumn('widget_key');
    t.dropColumn('widget_config');
  });
}
