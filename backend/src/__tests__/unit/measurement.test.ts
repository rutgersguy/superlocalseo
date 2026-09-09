import { summarizeAuditScores } from '../../services/audit_score.service';
import { latestRanks, latestCitations, rankKey, summarizeRanks, summarizeCitations, estimateTraffic, RankObservation, napVerdict } from '../../services/measurement.service';
import { periodDates } from '../../services/report.service';

const rank = (overrides: Partial<RankObservation> = {}): RankObservation => ({
  keywordId: 'k1', locationId: 'l1', keyword: 'plumber', location: 'One', searchEngine: 'google',
  geoLocation: null, rankType: 'organic', rank: 1, monthlySearchVolume: 1000,
  pulledAt: new Date('2026-08-31T12:00:00Z'), ...overrides,
});

describe('measurement accuracy', () => {
  it('counts observations, includes unranked coverage, and averages only ranked observations', () => {
    expect(summarizeRanks([1, 3, 10, 11, null].map(rank => ({ rank })))).toEqual({
      avgRank: 6.3, keywordsInTop3: 2, keywordsInTop10: 3, winning: 2, competing: 1,
      vulnerable: 1, absent: 1, observed: 5,
    });
    expect(summarizeRanks([]).avgRank).toBeNull();
    expect(summarizeRanks([{ rank: null }]).avgRank).toBeNull();
  });

  it('keeps engine, area and business location identities separate', () => {
    const rows = [rank(), rank({ searchEngine: 'bing' }), rank({ geoLocation: 'Tulsa' }), rank({ locationId: 'l2' })];
    expect(new Set(rows.map(rankKey)).size).toBe(4);
  });

  it('selects newest null results and scopes by tenant before classifying ranks', () => {
    const query = latestRanks('client', new Date('2026-09-01Z'), new Date('2026-08-01Z')).toSQL();
    expect(query.sql).toContain('distinct on ("rs"."keyword_id", "rs"."location_id", "rs"."search_engine", "rs"."geo_location")');
    expect(query.sql).toContain('"l"."client_id" = ?');
    expect(query.sql).toContain('"rs"."pulled_at" < ?');
    expect(query.sql).not.toMatch(/rank.*is not null/);
    expect(query.sql).toContain('rs.pulled_at DESC, rs.id DESC');
    expect(latestCitations('client', new Date()).toSQL().sql).toContain('"l"."client_id" = ?');
  });

  it('excludes unverified citations and unreadable NAP fields from their own denominators', () => {
    const rows = [
      { listed: true, verification_status: 'listed', nap_match: true },
      { listed: true, verification_status: 'listed', nap_match: false },
      { listed: true, verification_status: 'listed', nap_match: null },
      { listed: false, verification_status: 'not_found', nap_match: null },
      { listed: false, verification_status: 'unverified', nap_match: null },
    ];
    expect(summarizeCitations(rows)).toEqual({ total: 5, listed: 3, missing: 1, checked: 4, unverified: 1,
      napChecked: 2, napAccurate: 1, napDifferences: 1, score: 75 });
    expect(summarizeCitations([rows[4]]).score).toBeNull();
    expect(summarizeCitations([]).score).toBeNull();
  });

  it('uses stored volumes once per keyword/location, averages areas, and gives unranked areas zero clicks', () => {
    const result = estimateTraffic([rank(), rank({ geoLocation: 'area2', rank: null }), rank({ searchEngine: 'bing' })], { avgCustomerValue: 100, conversionRate: 10 });
    expect(result.keywords).toHaveLength(1);
    expect(result.totals).toEqual({ estClicks: 143, estLeads: 14.3, estRevenue: 1430 });
  });

  it('does not turn unavailable volume into a number or zero volume into a default', () => {
    expect(estimateTraffic([rank({ monthlySearchVolume: null })], {}).totals.estClicks).toBeNull();
    expect(estimateTraffic([rank({ monthlySearchVolume: 0 })], {}).totals.estClicks).toBe(0);
    expect(estimateTraffic([rank()], {}).totals.estRevenue).toBeNull();
    expect(estimateTraffic([rank()], { conversionRate: 0, avgCustomerValue: 100 }).totals.estRevenue).toBe(0);
  });

  it('uses half-open UTC months including leap days and rejects invalid report periods', () => {
    expect(periodDates(2, 2024)).toEqual({ start: new Date('2024-02-01T00:00:00Z'), end: new Date('2024-03-01T00:00:00Z') });
    expect(periodDates(12, 2026).end).toEqual(new Date('2027-01-01T00:00:00Z'));
    expect(() => periodDates(13, 2026)).toThrow('Invalid report period');
  });
});

describe('audit score boundaries and partial NAP', () => {
  it('does not declare partially readable details a complete match', () => {
    expect(napVerdict({ listed: true, nap_match: true, nap_name_match: true, nap_address_match: null, nap_phone_match: true })).toBeNull();
    expect(napVerdict({ listed: true, nap_match: true, nap_name_match: false, nap_address_match: null, nap_phone_match: true })).toBe(false);
  });
  it('keeps scores within 0–100 and includes unranked observations', () => {
    const c = [{ listed: true, nap_match: true, verification_status: 'listed' }];
    expect(summarizeAuditScores(c, [{rank: 1}]).compositeScore).toBe(100);
    expect(summarizeAuditScores(c, [{rank: 1}, {rank: null}])).toEqual({napScore:100, citationScore:100, rankingScore:50, compositeScore:85});
    expect(summarizeAuditScores([], []).compositeScore).toBeNull();
  });
});
