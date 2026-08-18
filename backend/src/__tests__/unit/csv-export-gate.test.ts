/**
 * CSV exports are Pro, and the gate must match what we sell (#157).
 *
 * PRICING.md and the landing page both list "CSV exports" under Pro. Lite could
 * nonetheless download rankings, keywords, reviews and citations, because
 * `reports` was absent from PLAN_ROUTE_GATES and that map is DEFAULT-ALLOW for
 * anything unlisted. Verified against a real Lite account before the fix.
 *
 * The decision (2026-08-18) was to enforce what is already sold rather than
 * rewrite the pricing page.
 */
import { isPlanAllowed } from '../../config/planFeatures';

describe('CSV export gating', () => {
  const EXPORTS = [
    'reports/export/rankings',
    'reports/export/keywords',
    'reports/export/reviews',
    'reports/export/citations',
    'analytics/export',
  ];

  it.each(EXPORTS)('blocks Lite from %s', (path) => {
    expect(isPlanAllowed(path, 'lite')).toBe(false);
  });

  it.each(EXPORTS)('allows Pro through %s', (path) => {
    expect(isPlanAllowed(path, 'pro')).toBe(true);
  });

  it('keeps the Reports page itself open to Lite', () => {
    // PRICING.md sells Lite as including Reports. Only the exports are Pro, so
    // gating the whole prefix would have been a different — and unsold —
    // takeaway.
    expect(isPlanAllowed('reports', 'lite')).toBe(true);
    expect(isPlanAllowed('reports/123/download', 'lite')).toBe(true);
    expect(isPlanAllowed('reports/generate', 'lite')).toBe(true);
  });

  it('leaves widgets open to Lite', () => {
    // Decided 2026-08-18: review widgets are Lite-inclusive. They were never
    // marketed as Pro, and a widget on the customer's site carries our branding.
    expect(isPlanAllowed('widget', 'lite')).toBe(true);
    expect(isPlanAllowed('widget/config', 'lite')).toBe(true);
  });
});
