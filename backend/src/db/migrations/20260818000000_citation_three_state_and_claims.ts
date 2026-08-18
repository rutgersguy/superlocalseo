import { Knex } from 'knex';

/**
 * Three-state citation verification, and self-attested claims (issues #174, #173).
 *
 * WHY A THIRD STATE
 * -----------------
 * `citation_snapshots.listed` is a boolean, so every scan had to resolve to
 * "listed" or "not listed". Measured against six real directories, THREE returned
 * no search result at all — and we cannot tell "this business has no listing here"
 * from "this listing exists but isn't indexed for our query".
 *
 * Reporting those as "not listed" sends the customer off to create a listing that
 * may already exist. `verification_status` makes the difference explicit:
 *
 *   listed      found, identity confirmed — NAP then matches or doesn't
 *   not_found   searched, no listing. Actionable: create one.
 *   unverified  we could not determine. Shown neutrally, EXCLUDED from the score,
 *               never presented as the customer's problem.
 *
 * `unverified_reason` is for us, not the customer. A directory that goes 100%
 * unverified means our parser broke, and that must be loud rather than silent —
 * the lesson from #149, where a dead upstream looked healthy for three months.
 *
 * SELF-ATTESTED CLAIMS
 * --------------------
 * Apple Maps and Bing Places publish no indexable listings, so no search-based
 * audit can reach them and neither exposes a read API. The customer claims them
 * through the free self-serve portals; `location_directory_claims` records that
 * they say they have.
 *
 * It is deliberately self-attested and MUST NEVER feed a score — we have not
 * verified anything and must not imply we have. Its value is that it stops the
 * prompt nagging and gives them a tracked checklist item they control.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('citation_snapshots', (t) => {
    t.string('verification_status', 20).notNullable().defaultTo('unverified');
    t.string('unverified_reason', 120).nullable();
    t.index(['verification_status'], 'citation_snapshots_verification_status_index');
  });

  // Backfill from the existing boolean so historical rows keep their meaning.
  // Old rows genuinely were determined — BrightLocal returned a definite answer —
  // so they map onto listed/not_found rather than unverified.
  await knex('citation_snapshots').where({ listed: true }).update({ verification_status: 'listed' });
  await knex('citation_snapshots').where({ listed: false }).update({ verification_status: 'not_found' });

  await knex.schema.createTable('location_directory_claims', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('location_id').notNullable().references('id').inTable('locations').onDelete('CASCADE');
    t.string('directory', 50).notNullable();
    t.timestamp('claimed_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.unique(['location_id', 'directory']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('location_directory_claims');
  await knex.schema.alterTable('citation_snapshots', (t) => {
    t.dropIndex(['verification_status'], 'citation_snapshots_verification_status_index');
    t.dropColumn('unverified_reason');
    t.dropColumn('verification_status');
  });
}
