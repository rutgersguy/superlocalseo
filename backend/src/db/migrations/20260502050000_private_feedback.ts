import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('private_feedback', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('client_id').notNullable().references('id').inTable('clients').onDelete('CASCADE');
    t.string('emr_feedback_id', 255).notNullable().unique();
    t.string('campaign_id', 255).nullable();
    t.string('contact_name', 255).nullable();
    t.string('contact_email', 255).nullable();
    t.string('contact_phone', 100).nullable();
    t.integer('rating').nullable();
    t.text('message').nullable();
    t.timestamp('received_at').notNullable();
    t.timestamps(true, true);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('private_feedback');
}
