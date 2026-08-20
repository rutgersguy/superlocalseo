import { Knex } from 'knex';

/**
 * AI assistant visibility tracking.
 *
 * WHY THIS TABLE EXISTS
 * ---------------------
 * The marketing site claims we check whether ChatGPT, Gemini and Perplexity
 * recommend a business. Until this migration that claim was true only of the
 * free lead-magnet report: those three names appeared in exactly one file in the
 * repo — `frontend/src/pages/Landing.tsx` — and the paid product never measured
 * them. See docs/POSITIONING.md, which makes matching the hero claim to the
 * dashboard a standing rule rather than a one-off fix.
 *
 * ONE ROW PER (LOCATION, PROMPT, ENGINE, RUN)
 * -------------------------------------------
 * Snapshots are append-only, like `ranking_snapshots` and `citation_snapshots`,
 * because the product's differentiator is history: the interesting question is
 * not "am I mentioned" but "am I mentioned more than I was last month".
 *
 * VOLUME: locations × 4 prompts × 3 engines, weekly — 12 rows per location per
 * week, ~50 rows a month. Three orders of magnitude below `serp_competitors`,
 * so no retention sweep is needed yet.
 *
 * `response_text` is kept in full. It is the evidence behind the verdict, it is
 * what makes a disputed "you were not mentioned" answerable, and at roughly 2KB
 * a row the storage is irrelevant next to being able to show the customer the
 * actual answer.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('ai_visibility_snapshots', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('location_id').notNullable().references('id').inTable('locations').onDelete('CASCADE');

    // Stable key from AI_PROMPTS; prompt_text is the exact string sent, so a
    // reworded template stays auditable against the answers it produced.
    t.string('prompt_key', 60).notNullable();
    t.text('prompt_text').notNullable();

    t.string('engine', 20).notNullable();
    t.string('model_name', 80).notNullable();

    // mentioned | absent | unverified.
    //
    // `unverified` is a first-class state, not an error to be cleaned up later:
    // a rate-limited request, a refusal, or a business name made entirely of
    // generic trade words all mean "we could not determine this". Recording any
    // of them as `absent` would tell a paying customer that ChatGPT declined to
    // recommend them on evidence we do not have. Scoring must exclude it rather
    // than count it against the business — the same rule as citation_snapshots
    // (#174).
    t.string('status', 20).notNullable();
    t.text('unverified_reason').nullable();

    // 1-based rank among the businesses the answer named. Null unless mentioned.
    t.integer('position').nullable();

    // Every business named, in order — the competitor set for this answer.
    t.jsonb('businesses_named').notNullable().defaultTo('[]');
    // Hostnames the assistant cited. Directly actionable: these are the sources
    // that decide local recommendations, and several are places a business can
    // get itself listed.
    t.jsonb('citations').notNullable().defaultTo('[]');

    // Null when the call failed — there is no answer to keep.
    t.text('response_text').nullable();

    t.integer('input_tokens').notNullable().defaultTo(0);
    t.integer('output_tokens').notNullable().defaultTo(0);
    t.decimal('cost_usd', 10, 6).notNullable().defaultTo(0);

    t.timestamp('scanned_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    t.index(['location_id', 'scanned_at'], 'ai_visibility_location_scanned_index');
    t.index(['location_id', 'engine', 'scanned_at'], 'ai_visibility_location_engine_scanned_index');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('ai_visibility_snapshots');
}
