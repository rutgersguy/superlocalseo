import { Knex } from 'knex';

/**
 * Lite plans cannot trigger the daily manual rankings refresh (rankings/sync is
 * Pro-gated), which meant a new Lite client had to wait until the nightly job
 * (06:00 UTC) to see any ranking data at all. They now get exactly one manual
 * scan, tracked here.
 *
 * This lives in the DB rather than Redis (which backs the Pro 24h cooldown)
 * because a Redis flush must not hand out extra free scans.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('clients', (t) => {
    t.timestamp('manual_scan_used_at', { useTz: true }).nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('clients', (t) => {
    t.dropColumn('manual_scan_used_at');
  });
}
