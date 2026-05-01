import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('clients', (t) => {
    t.string('white_label_company_name', 255).nullable();
    t.text('white_label_logo_url').nullable();
    t.string('white_label_color', 7).nullable(); // hex e.g. #0052CC
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('clients', (t) => {
    t.dropColumn('white_label_company_name');
    t.dropColumn('white_label_logo_url');
    t.dropColumn('white_label_color');
  });
}
