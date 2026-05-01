import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('reviews', (t) => {
    t.boolean('replied').notNullable().defaultTo(false);
    t.timestamp('reply_date').nullable();
    t.text('emr_reply_text').nullable();
    t.boolean('hidden').notNullable().defaultTo(false);
    t.string('avatar_url', 512).nullable();
    t.boolean('verified').nullable();
  });

  await knex.schema.createTable('emr_campaigns', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('client_id').notNullable().references('id').inTable('clients').onDelete('CASCADE');
    t.string('emr_campaign_id', 255).notNullable();
    t.string('name', 255).notNullable();
    // Funnel metrics snapshot
    t.integer('invited').defaultTo(0);
    t.integer('opened').defaultTo(0);
    t.integer('clicked').defaultTo(0);
    t.integer('reviewed').defaultTo(0);
    t.integer('private_feedback').defaultTo(0);
    t.integer('unsubscribed').defaultTo(0);
    t.timestamp('metrics_pulled_at').nullable();
    t.timestamps(true, true);
    t.unique(['client_id', 'emr_campaign_id']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('emr_campaigns');
  await knex.schema.alterTable('reviews', (t) => {
    t.dropColumn('replied');
    t.dropColumn('reply_date');
    t.dropColumn('emr_reply_text');
    t.dropColumn('hidden');
    t.dropColumn('avatar_url');
    t.dropColumn('verified');
  });
}
