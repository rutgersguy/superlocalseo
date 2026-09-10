import type {Knex} from 'knex';
export async function up(knex:Knex):Promise<void>{
  await knex.schema.alterTable('reports',t=>{
    t.uuid('generation_token').nullable();t.timestamp('generation_started_at').nullable();
    t.string('email_status',30).notNullable().defaultTo('legacy_unknown');
    t.string('email_provider_id',255).nullable();t.timestamp('email_attempted_at').nullable();
    t.jsonb('email_payload').nullable();
  });
}
export async function down():Promise<void>{}
