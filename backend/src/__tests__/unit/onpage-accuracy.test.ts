import { checkOnPageSeo } from '../../services/onpage.service';
import { renderAuditReportHtml } from '../../services/audit_report.service';

const originalFetch = global.fetch;
afterEach(() => { global.fetch = originalFetch; });

describe('on-page evidence accuracy', () => {
  it('does not score an unreachable or forbidden page as a failed audit', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('network error'));
    expect((await checkOnPageSeo('https://example.com')).score).toBeNull();
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 403 });
    expect((await checkOnPageSeo('https://example.com')).score).toBeNull();
  });
  it('checks the final response URL for HTTPS after redirects', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, url: 'https://example.com/', text: async () => '<html></html>' });
    const result = await checkOnPageSeo('http://example.com');
    expect(result.details).toContain('Site served over HTTPS');
    expect(result.score).toBe(10);
  });
  it('does not turn unscored Lighthouse checks into failing recommendations', () => {
    const html = renderAuditReportHtml({ location_name: 'Example', on_page_score: null,
      dfs_on_page_data: { performanceScore: 80, accessibilityScore: 80, bestPracticesScore: 80, seoScore: 80,
        categoryAudits: { performance: [{ title: 'UNSCORED_SENTINEL', score: null }], accessibility: [], bestPractices: [], seo: [] } } });
    expect(html).not.toContain('UNSCORED_SENTINEL');
    expect(html).not.toContain('these signals directly affect your search rankings');
  });
});
