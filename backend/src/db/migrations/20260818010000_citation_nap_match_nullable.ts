import { Knex } from 'knex';

/**
 * `citation_snapshots.nap_match` becomes nullable (#174).
 *
 * The column was NOT NULL, so "we found the listing but could not read its
 * NAP" had to be written as `false` — which every reader then interpreted as
 * "the NAP is wrong". The Citations page showed "NAP mismatch" and the monthly
 * PDF counted it against the accuracy figure, both asserting a comparison that
 * was never performed.
 *
 * This is not hypothetical: Facebook listings carry no address in their search
 * snippet, and they resolved for 30 of 34 businesses in measurement. Every one
 * of those would have been reported to the customer as a NAP mismatch to go and
 * fix.
 *
 * NULL now means "not checked", which the three-state model already uses for
 * the per-field nap_*_match columns. Existing rows are left alone: they were
 * written by the BrightLocal path, which always had a definite answer.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('citation_snapshots', (t) => {
    t.boolean('nap_match').nullable().alter();
  });
}

export async function down(knex: Knex): Promise<void> {
  // A NULL cannot survive the NOT NULL constraint, and false is the value the
  // old schema would have held for these rows.
  await knex('citation_snapshots').whereNull('nap_match').update({ nap_match: false });
  await knex.schema.alterTable('citation_snapshots', (t) => {
    t.boolean('nap_match').notNullable().defaultTo(false).alter();
  });
}
