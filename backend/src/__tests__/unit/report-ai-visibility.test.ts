/**
 * The AI visibility section of the monthly PDF (#192).
 *
 * The report is the artifact a customer actually opens and forwards, so the two
 * rules that govern this feature everywhere else have to hold here too, and in
 * a template they are easy to lose:
 *
 *   1. `unverified` is not `absent`. A month an assistant was unreachable must
 *      not print as a decline in the customer's visibility.
 *   2. Lite gets the verdict, Pro gets the depth. The competitor list is
 *      withheld in gatherReportData, not hidden in the template, so a future
 *      template edit cannot leak it.
 */
import { renderReportHtml, ReportData } from '../../services/report.service';

function baseData(overrides: Partial<ReportData> = {}): ReportData {
  return {
    client: { businessName: 'Broadnax Heating and Air', email: 'owner@example.com' },
    plan: 'pro',
    period: { month: 8, year: 2026, label: 'August 2026' },
    locations: [{ id: 'loc-1', name: 'Bixby' }],
    rankings: { avgRank: 8.2, keywordsInTop3: 2, keywordsInTop10: 5, topKeywords: [] },
    reviews: { total: 42, newThisMonth: 6, avgRating: 4.7, byPlatform: [] },
    citations: { score: 86, listed: 12, total: 14, napAccurate: 11, napChecked: 12 },
    competitors: [],
    clientStats: { avgRating: 4.7, reviewCount: 42 },
    gap: { winning: 1, competing: 1, vulnerable: 0, absent: 0, atRisk: [] },
    sentiment: { positive: 30, neutral: 8, negative: 4 },
    visibility: { current: 71, delta: 3 },
    auditScore: 78,
    roi: null,
    aiVisibility: {
      scannedAt: new Date('2026-08-17T08:00:00Z'),
      mentionRate: 67,
      priorMentionRate: 50,
      engines: [
        { engine: 'chat_gpt', label: 'ChatGPT', mentioned: 3, absent: 1, unverified: 0, determinate: 4, bestPosition: 2 },
        { engine: 'claude', label: 'Claude', mentioned: 4, absent: 0, unverified: 0, determinate: 4, bestPosition: 1 },
        { engine: 'gemini', label: 'Gemini', mentioned: 0, absent: 4, unverified: 0, determinate: 4, bestPosition: null },
        { engine: 'perplexity', label: 'Perplexity', mentioned: 0, absent: 0, unverified: 4, determinate: 0, bestPosition: null },
      ],
      topCompetitors: [
        { name: 'Broadnax Heating and Air', timesNamed: 9, isYou: true },
        { name: 'JayCo HVACR LLC', timesNamed: 6, isYou: false },
        { name: 'Patton Air', timesNamed: 3, isYou: false },
      ],
    },
    ...overrides,
  };
}

describe('report — AI visibility section', () => {
  it('renders the rate and every assistant', () => {
    const html = renderReportHtml(baseData());
    expect(html).toContain('AI Assistant Visibility');
    expect(html).toContain('67%');
    for (const label of ['ChatGPT', 'Claude', 'Gemini', 'Perplexity']) {
      expect(html).toContain(label);
    }
  });

  it('shows an unreachable assistant as unchecked, never as not recommended', () => {
    // Perplexity is 0 mentioned / 0 absent / 4 unverified. Printing "Not
    // mentioned" there would tell the customer Perplexity declined to
    // recommend them on evidence we do not have.
    const html = renderReportHtml(baseData());
    const perplexityRow = html.slice(html.indexOf('Perplexity'), html.indexOf('Perplexity') + 400);
    expect(perplexityRow).toContain("Couldn't check");
    expect(perplexityRow).not.toContain('Not mentioned');
  });

  it('states that unchecked results are excluded from the percentage', () => {
    const html = renderReportHtml(baseData());
    expect(html).toMatch(/excluded from the percentage rather than counted against you/i);
  });

  it('shows the month-over-month movement', () => {
    const html = renderReportHtml(baseData());
    expect(html).toMatch(/17 points vs last month/);
  });

  it('says so plainly when there is no prior month to compare', () => {
    const data = baseData();
    data.aiVisibility!.priorMentionRate = null;
    const html = renderReportHtml(data);
    expect(html).toMatch(/no comparison for last month/i);
  });

  it('omits the whole section when no scan landed in the month', () => {
    // An empty panel reads as a broken report.
    const html = renderReportHtml(baseData({ aiVisibility: null }));
    expect(html).not.toContain('AI Assistant Visibility');
    // ...and the rest of the report still renders.
    expect(html).toContain('Executive Summary');
    expect(html).toContain('Citation Health');
  });

  it('gives Pro the competitor list', () => {
    const html = renderReportHtml(baseData());
    expect(html).toContain('Who the assistants named this month');
    expect(html).toContain('JayCo HVACR LLC');
  });

  it("marks the customer's own business in the named list", () => {
    // It is named more often than anyone, being the business we asked about.
    // Unmarked it topped the list and read as self-competition — seen in the
    // first real August PDF.
    const html = renderReportHtml(baseData());
    expect(html).toContain('Broadnax Heating and Air (you)');
  });

  it('withholds the competitor list from Lite', () => {
    // gatherReportData leaves topCompetitors empty for Lite; the template must
    // then render nothing at all rather than an empty heading.
    const data = baseData({ plan: 'lite' });
    data.aiVisibility!.topCompetitors = [];
    const html = renderReportHtml(data);

    expect(html).not.toContain('Who the assistants named this month');
    expect(html).not.toContain('JayCo HVACR LLC');
    // The verdict Lite pays for is still there.
    expect(html).toContain('AI Assistant Visibility');
    expect(html).toContain('67%');
  });
});

describe('report — AI visibility recommendations', () => {
  it('leads with the assistants that did not name the business', () => {
    const html = renderReportHtml(baseData());
    expect(html).toMatch(/Gemini did not name your business this month/);
  });

  it('escalates when no assistant recommended them at all', () => {
    const data = baseData();
    data.aiVisibility!.engines = data.aiVisibility!.engines.map((e) => ({
      ...e, mentioned: 0, absent: 4, unverified: 0, determinate: 4, bestPosition: null,
    }));
    data.aiVisibility!.mentionRate = 0;
    const html = renderReportHtml(data);
    expect(html).toMatch(/No AI assistant recommended you this month/);
  });

  it('flags a drop against last month', () => {
    const data = baseData();
    data.aiVisibility!.mentionRate = 40;
    data.aiVisibility!.priorMentionRate = 70;
    const html = renderReportHtml(data);
    expect(html).toMatch(/fell from 70% to 40%/);
  });

  it('does not invent an AI recommendation when there was no scan', () => {
    const html = renderReportHtml(baseData({ aiVisibility: null }));
    expect(html).not.toMatch(/AI assistant recommended you/);
  });
});
