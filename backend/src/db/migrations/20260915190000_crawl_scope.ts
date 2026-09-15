import type { Knex } from 'knex';
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('locations', t => { t.string('website_crawl_scope').notNullable().defaultTo('auto'); });
}
export async function down(): Promise<void> { /* Preserve customer crawl preferences. */ }
