import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('reviews', (t) => {
    t.string('bl_review_id', 255).nullable();
    t.string('bl_reply_status', 50).nullable();
    t.timestamp('bl_reply_posted_at').nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('reviews', (t) => {
    t.dropColumn('bl_review_id');
    t.dropColumn('bl_reply_status');
    t.dropColumn('bl_reply_posted_at');
  });
}
