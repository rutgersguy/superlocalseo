import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('citation_snapshots', (t) => {
    t.boolean('nap_name_match').nullable();
    t.boolean('nap_address_match').nullable();
    t.boolean('nap_phone_match').nullable();
    t.string('listed_name', 500).nullable();
    t.string('listed_address', 500).nullable();
    t.string('listed_phone', 100).nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('citation_snapshots', (t) => {
    t.dropColumn('nap_name_match');
    t.dropColumn('nap_address_match');
    t.dropColumn('nap_phone_match');
    t.dropColumn('listed_name');
    t.dropColumn('listed_address');
    t.dropColumn('listed_phone');
  });
}
