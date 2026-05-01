import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('review_responses', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('review_id').notNullable().references('id').inTable('reviews').onDelete('CASCADE').unique();
    t.uuid('client_id').notNullable().references('id').inTable('clients').onDelete('CASCADE');
    t.text('draft_body').notNullable();
    t.text('final_body').nullable();
    t.string('status', 50).notNullable().defaultTo('draft'); // 'draft' | 'approved'
    t.timestamp('approved_at').nullable();
    t.timestamps(true, true);
  });
  await knex.raw('CREATE INDEX idx_review_responses_client ON review_responses (client_id)');
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('review_responses');
}
