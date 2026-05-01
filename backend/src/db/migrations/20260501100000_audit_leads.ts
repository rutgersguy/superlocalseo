import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('audit_leads', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.string('business_name', 255).notNullable();
    t.string('city', 255).notNullable();
    t.string('keyword', 255);
    t.string('email', 255);
    t.jsonb('audit_data');
    t.string('google_place_id', 255);
    t.timestamp('converted_at');
    t.timestamps(true, true);
  });
  await knex.raw('CREATE INDEX idx_audit_leads_email ON audit_leads (email)');
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('audit_leads');
}
