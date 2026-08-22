/**
 * The two review sources must agree, or reviews duplicate and disappear.
 *
 * EmbedMyReviews and our own Google Business Profile connection can both supply
 * Google reviews. Enabling the direct path exposed two ways they disagreed, and
 * neither would have raised an error:
 *
 *   1. CASING. EMR stores `platform: 'Google'`; the GBP path hardcoded
 *      `'google'`. The unique index is (client_id, platform, external_review_id)
 *      and Postgres is case-sensitive, so the same review from both sources does
 *      not collide — it is stored twice. The Reviews page also filters on the
 *      literal strings ['All','Google','Yelp','Facebook'], so a lowercase row
 *      vanishes from the Google filter while still appearing under "All".
 *
 *   2. IDENTITY. Even with matching casing, the two use different ids for the
 *      same review — EMR its own sequential integers ("11", "12", "16"),
 *      Google a long opaque reviewId. No index can dedupe across that, which is
 *      why the job picks ONE source per client rather than merging.
 *
 * These assert the agreement rather than the mechanism, because the mechanism
 * lives in three files that have no reason to be edited together.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const gbpService = readFileSync(join(__dirname, '../../services/gbp.service.ts'), 'utf8');
const reviewsJob = readFileSync(join(__dirname, '../../jobs/reviews.job.ts'), 'utf8');
const reviewsPage = readFileSync(
  join(__dirname, '../../../../frontend/src/pages/Reviews.tsx'),
  'utf8',
);

describe('review source consistency', () => {
  it('the GBP path writes the capitalised platform the rest of the system uses', () => {
    expect(gbpService).toMatch(/platform: 'Google'/);
    expect(gbpService).not.toMatch(/platform: 'google'/);
  });

  it('the Reviews page filter includes that exact string', () => {
    // If someone lowercases the filter list, GBP rows stop matching it.
    expect(reviewsPage).toMatch(/PLATFORMS\s*=\s*\[[^\]]*'Google'/);
  });

  it('both writers dedupe on the same key', () => {
    const key = /onConflict\(\['client_id', 'platform', 'external_review_id'\]\)/;
    expect(gbpService).toMatch(key);
    expect(reviewsJob).toMatch(key);
  });

  it('EMR skips Google for clients with their own Google connection', () => {
    // The guard against storing one review twice under two different ids.
    expect(reviewsJob).toMatch(/gbpConnectedClientIds/);
    expect(reviewsJob).toMatch(/toLowerCase\(\) === 'google'/);
  });

  it('GBP sync is opt-out now that the quota blocker is gone', () => {
    // It was opt-in while Google had not granted the quota. Leaving it opt-in
    // means a connected Google account silently does nothing.
    expect(reviewsJob).toMatch(/GBP_SYNC_ENABLED !== 'false'/);
  });
});
