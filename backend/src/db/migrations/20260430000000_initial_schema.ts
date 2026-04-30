import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.raw('CREATE EXTENSION IF NOT EXISTS "pgcrypto"');

  await knex.schema.createTable('users', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.string('email', 255).notNullable().unique();
    t.string('password_hash', 255).notNullable();
    t.string('role', 50).notNullable().defaultTo('client');
    t.string('stripe_customer_id', 255);
    t.boolean('email_verified').notNullable().defaultTo(false);
    t.timestamps(true, true);
  });

  await knex.schema.createTable('clients', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.string('business_name', 255).notNullable();
    t.string('industry', 100);
    t.string('stripe_subscription_id', 255);
    t.integer('subscription_tier').notNullable().defaultTo(1);
    t.string('subscription_status', 50).notNullable().defaultTo('trialing');
    t.timestamp('subscription_current_period_end');
    t.timestamp('payment_failed_at');
    t.integer('onboarding_step').notNullable().defaultTo(0);
    t.timestamps(true, true);
  });

  await knex.schema.createTable('locations', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('client_id').notNullable().references('id').inTable('clients').onDelete('CASCADE');
    t.string('name', 255).notNullable();
    t.string('address', 500);
    t.string('city', 100);
    t.string('state', 50);
    t.string('zip', 20);
    t.string('phone', 50);
    t.string('website', 500);
    t.string('brightlocal_campaign_id', 255);
    t.boolean('is_primary').notNullable().defaultTo(false);
    t.timestamps(true, true);
  });

  await knex.schema.createTable('integrations', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('client_id').notNullable().references('id').inTable('clients').onDelete('CASCADE');
    t.string('provider', 50).notNullable();
    t.text('api_key_encrypted');
    t.string('status', 50).notNullable().defaultTo('disconnected');
    t.timestamp('last_pull_at');
    t.text('error_message');
    t.timestamps(true, true);
    t.unique(['client_id', 'provider']);
  });

  await knex.schema.createTable('keywords', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('location_id').notNullable().references('id').inTable('locations').onDelete('CASCADE');
    t.string('keyword', 255).notNullable();
    t.timestamps(true, true);
    t.unique(['location_id', 'keyword']);
  });

  await knex.schema.createTable('ranking_snapshots', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('keyword_id').notNullable().references('id').inTable('keywords').onDelete('CASCADE');
    t.uuid('location_id').notNullable().references('id').inTable('locations').onDelete('CASCADE');
    t.integer('rank');
    t.string('url_ranked', 2000);
    t.string('search_engine', 50).notNullable().defaultTo('google');
    t.timestamp('pulled_at').notNullable().defaultTo(knex.fn.now());
  });
  await knex.raw('CREATE INDEX idx_ranking_snapshots_trend ON ranking_snapshots (keyword_id, location_id, pulled_at DESC)');

  await knex.schema.createTable('citation_snapshots', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('location_id').notNullable().references('id').inTable('locations').onDelete('CASCADE');
    t.string('directory', 100).notNullable();
    t.boolean('listed').notNullable().defaultTo(false);
    t.boolean('nap_match').notNullable().defaultTo(false);
    t.string('listing_url', 2000);
    t.timestamp('pulled_at').notNullable().defaultTo(knex.fn.now());
  });
  await knex.raw('CREATE INDEX idx_citation_snapshots_location ON citation_snapshots (location_id, pulled_at DESC)');

  await knex.schema.createTable('reviews', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('client_id').notNullable().references('id').inTable('clients').onDelete('CASCADE');
    t.uuid('location_id').references('id').inTable('locations').onDelete('SET NULL');
    t.string('platform', 50).notNullable();
    t.string('external_review_id', 255).notNullable();
    t.string('author_name', 255);
    t.integer('rating').notNullable();
    t.text('body');
    t.string('sentiment', 20);
    t.string('status', 50).notNullable().defaultTo('new');
    t.timestamp('review_date');
    t.timestamp('ingested_at').notNullable().defaultTo(knex.fn.now());
    t.string('platform_url', 2000);
    t.unique(['platform', 'external_review_id']);
  });

  await knex.schema.createTable('reports', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('client_id').notNullable().references('id').inTable('clients').onDelete('CASCADE');
    t.integer('period_month').notNullable();
    t.integer('period_year').notNullable();
    t.string('status', 50).notNullable().defaultTo('pending');
    t.string('file_path', 1000);
    t.timestamp('generated_at');
    t.timestamp('sent_at');
    t.string('email_recipient', 255);
    t.timestamps(true, true);
    t.unique(['client_id', 'period_month', 'period_year']);
  });

  await knex.schema.createTable('metrics_daily', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('client_id').notNullable().references('id').inTable('clients').onDelete('CASCADE');
    t.uuid('location_id').notNullable().references('id').inTable('locations').onDelete('CASCADE');
    t.date('date').notNullable();
    t.decimal('avg_ranking', 6, 2);
    t.integer('top_10_count').defaultTo(0);
    t.integer('review_count').defaultTo(0);
    t.decimal('avg_rating', 3, 2);
    t.decimal('citation_completeness', 5, 2);
    t.unique(['client_id', 'location_id', 'date']);
  });

  await knex.schema.createTable('audit_logs', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('user_id').references('id').inTable('users').onDelete('SET NULL');
    t.string('action', 100).notNullable();
    t.string('resource_type', 100);
    t.uuid('resource_id');
    t.jsonb('metadata');
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
  });
}

export async function down(knex: Knex): Promise<void> {
  const tables = ['audit_logs', 'metrics_daily', 'reports', 'reviews', 'citation_snapshots', 'ranking_snapshots', 'keywords', 'integrations', 'locations', 'clients', 'users'];
  for (const t of tables) await knex.schema.dropTableIfExists(t);
}
