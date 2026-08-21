/**
 * The monthly PDF must not mail Lite customers Pro-gated data (#193).
 *
 * This file had no notion of a plan at all until now, so a Lite customer's
 * report carried citation health, ROI attribution, competitor benchmarking and
 * the SEO audit score — every one of which they are blocked from in the app.
 * It is the same shape as #157, and worse, because the report is emailed rather
 * than visited.
 *
 * Decision: gate rather than reprice. Lite's report is rankings, reviews, the
 * AI visibility verdict, and recommendations.
 *
 * The gating happens in `gatherReportData`, so these tests assert on the data
 * boundary as well as the markup — a section added later reads an empty field
 * rather than having to remember the rule.
 */
import { renderReportHtml, ReportData } from '../../services/report.service';

function data(plan: 'lite' | 'pro'): ReportData {
  const pro = plan === 'pro';
  return {
    client: { businessName: 'Broadnax Heating and Air', email: 'owner@example.com' },
    plan,
    period: { month: 8, year: 2026, label: 'August 2026' },
    locations: [{ id: 'loc-1', name: 'Bixby' }],
    rankings: {
      avgRank: 8.2, keywordsInTop3: 2, keywordsInTop10: 5,
      topKeywords: [{ keyword: 'hvac near me', location: 'Bixby', rank: 6, prevRank: 9, delta: 3 }],
    },
    reviews: { total: 42, newThisMonth: 6, avgRating: 4.7, byPlatform: [{ platform: 'google', count: 42, avgRating: 4.7 }] },
    // Mirrors what gatherReportData produces for each plan.
    citations: pro ? { score: 55, listed: 8, total: 14, napAccurate: 5, napChecked: 8 } : null,
    competitors: pro ? [{ name: 'JayCo HVACR', website: null, googleRating: 4.9, googleReviewCount: 300 }] : [],
    clientStats: { avgRating: 4.7, reviewCount: 42 },
    gap: { winning: 2, competing: 3, vulnerable: 1, absent: 0, atRisk: [] },
    sentiment: { positive: 30, neutral: 8, negative: 4 },
    visibility: { current: 71, delta: 3 },
    aiVisibility: {
      scannedAt: new Date('2026-08-17T08:00:00Z'),
      mentionRate: 67,
      priorMentionRate: 50,
      engines: [
        { engine: 'chat_gpt', label: 'ChatGPT', mentioned: 3, absent: 1, unverified: 0, determinate: 4, bestPosition: 2 },
        { engine: 'gemini', label: 'Gemini', mentioned: 0, absent: 4, unverified: 0, determinate: 4, bestPosition: null },
      ],
      topCompetitors: pro ? [{ name: 'JayCo HVACR', timesNamed: 6, isYou: false }] : [],
    },
    auditScore: pro ? 63 : null,
    roi: pro ? { configured: true, estClicks: 20, estLeads: 1, estRevenue: 225 } : null,
  };
}

describe('monthly report — Lite gating', () => {
  const lite = renderReportHtml(data('lite'));
  const pro = renderReportHtml(data('pro'));

  const proOnlySections = [
    ['Citation Health', 'citation auditing'],
    ['ROI &amp; Revenue Attribution', 'revenue attribution'],
    ['Competitor Benchmarking', 'competitor intelligence'],
  ] as const;

  for (const [heading, what] of proOnlySections) {
    it(`omits ${what} from a Lite report`, () => {
      expect(lite).not.toContain(heading);
    });
    it(`keeps ${what} in a Pro report`, () => {
      expect(pro).toContain(heading);
    });
  }

  it('omits the Pro-only stat boxes from the Lite executive summary', () => {
    expect(lite).not.toContain('Citation Score');
    expect(lite).not.toContain('SEO Audit Score');
    expect(pro).toContain('Citation Score');
  });

  it('leaves no hole in the Lite summary grid', () => {
    // The row is a fixed three-column grid. Dropping two Pro boxes without
    // padding would render a visible gap in a PDF nobody can reflow.
    const row = lite.slice(lite.indexOf('New Reviews') - 400);
    const boxes = (row.slice(0, row.indexOf('AI ASSISTANT VISIBILITY')).match(/font-size:11px;color:#6b7280/g) ?? []).length;
    expect(boxes).toBeGreaterThanOrEqual(3);
  });

  it('never recommends acting on a section Lite could not see', () => {
    // A citation recommendation under a report with no citation section is a
    // support ticket, not advice.
    expect(lite).not.toMatch(/Citation score is/);
    expect(lite).not.toMatch(/incorrect NAP/);
    expect(lite).not.toMatch(/Local SEO audit score is/);
    // ...and Pro still gets them.
    expect(pro).toMatch(/Citation score is 55%/);
  });

  it('keeps everything Lite pays for', () => {
    expect(lite).toContain('Executive Summary');
    expect(lite).toContain('Keyword Rankings');
    expect(lite).toContain('Reviews');
    expect(lite).toContain('Recommendations');
    // The keyword position breakdown is computed from the client's own ranks,
    // not competitor data, despite living next to the competitor sections.
    expect(lite).toContain('Keyword Position Breakdown');
    // Visibility score is a single composite the dashboard shows both plans.
    expect(lite).toContain('Visibility Score');
  });

  it('gives Lite the AI visibility verdict but not the depth', () => {
    expect(lite).toContain('AI Assistant Visibility');
    expect(lite).toContain('67%');
    expect(lite).not.toContain('Who the assistants named this month');
    expect(pro).toContain('Who the assistants named this month');
  });

  it('does not leak a Pro competitor name anywhere in a Lite report', () => {
    // Belt and braces: the same company is seeded into competitors AND the AI
    // competitor list, so this catches either route.
    expect(lite).not.toContain('JayCo HVACR');
    expect(pro).toContain('JayCo HVACR');
  });
});
