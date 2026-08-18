/**
 * The industry → directory mapping has exactly one source of truth (#184).
 *
 * Two bugs lived here, both silent:
 *
 *   1. The `Real Estate` industry was assigned `group: 'Professional Services'`,
 *      so realtors were served ZoomInfo and Clutch while the `Real Estate`
 *      directory group — Zillow and Realtor.com, both measured well enough to
 *      ship — was unreachable in production.
 *
 *   2. `industry.config.ts` kept its OWN `CORE_DIRECTORIES` and
 *      `GROUP_DIRECTORIES` copies. They went stale the moment #174 chose the
 *      shipped set by measurement, and `audit_score.service.ts` computes the
 *      citation score as "listed / target directories" — so it was dividing by
 *      directories the scanner no longer checks. Those can never come back
 *      listed, so 40% of every affected customer's composite audit score was
 *      being dragged down by directories we had deliberately stopped auditing.
 *
 * Neither surfaced as an error. Both need a test rather than a reading.
 */
import { getDirectoriesForIndustry, INDUSTRY_MAP } from '../../config/industry.config';
import { DIRECTORIES, directoriesForVertical, Vertical } from '../../config/directories.config';

describe('getDirectoriesForIndustry', () => {
  it('gives real-estate industries the real-estate directories', () => {
    for (const industry of ['Real Estate', 'Property Management']) {
      const dirs = getDirectoriesForIndustry(industry);
      expect(dirs).toContain('zillow');
      expect(dirs).toContain('realtor');
    }
  });

  it('does not leak vertical directories into an unrelated industry', () => {
    const salon = getDirectoriesForIndustry('Hair Salon');
    expect(salon).toContain('fresha');
    expect(salon).not.toContain('zillow');
    expect(salon).not.toContain('healthgrades');
  });

  it('never returns a directory that measurement disqualified', () => {
    // The stale-copy bug in one assertion: every industry, checked against the
    // authoritative registry.
    const dropped = Object.values(DIRECTORIES).filter((d) => d.unsupported || d.unauditable).map((d) => d.key);
    for (const industry of Object.keys(INDUSTRY_MAP)) {
      const dirs = getDirectoriesForIndustry(industry);
      expect(dirs.filter((d) => dropped.includes(d))).toEqual([]);
    }
  });

  it('agrees exactly with the scanner for every industry', () => {
    // The audit score and the scan must target the same set, or the score is
    // computed against directories that were never scanned.
    for (const [industry, def] of Object.entries(INDUSTRY_MAP)) {
      const viaIndustry = getDirectoriesForIndustry(industry).sort();
      // Mirrors verticalForGroup rather than importing it, so a bug in that
      // mapping is caught here instead of being assumed correct.
      const GROUPS: Record<string, Vertical> = {
        'Home Services': 'home',
        'Health & Fitness': 'health',
        Legal: 'legal',
        'Food & Beverage': 'food',
        'Beauty & Personal Care': 'beauty',
        Automotive: 'auto',
        'Professional Services': 'professional',
        'Real Estate': 'realestate',
      };
      const viaVertical = directoriesForVertical(GROUPS[def.group] ?? null)
        .map((d) => d.key)
        .sort();
      expect(viaIndustry).toEqual(viaVertical);
    }
  });

  it('falls back to the core set for an unknown or missing industry', () => {
    const core = directoriesForVertical(null).map((d) => d.key).sort();
    expect(getDirectoriesForIndustry(null).sort()).toEqual(core);
    expect(getDirectoriesForIndustry('Not A Real Industry').sort()).toEqual(core);
  });
});
