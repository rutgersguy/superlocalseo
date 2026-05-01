import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('clients', (t) => {
    t.string('emr_customer_id', 255).nullable();
    t.string('emr_provisioning_status', 50).notNullable().defaultTo('pending');
    // pending | provisioned | failed | deprovisioned
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('clients', (t) => {
    t.dropColumn('emr_customer_id');
    t.dropColumn('emr_provisioning_status');
  });
}
