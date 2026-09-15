import { crawlPolicy, crawlTaskOptions, isCrawlPageAllowed, normalizeCrawlUrl } from '../services/website_crawl_policy';
describe('crawl cost and scope boundaries', () => {
  it('uses 25 pages and depth three without sitemap depth bypass', () => {
    expect(crawlTaskOptions('https://example.com/', '')).toMatchObject({ max_crawl_pages: 25, max_crawl_depth: 3, respect_sitemap: false, allow_subdomains: false, robots_txt_merge_mode: 'merge' });
  });
  it('does not infer a location section from a URL', () => {
    expect(crawlPolicy('https://example.com/tulsa/')).toMatchObject({ scope: 'saved_page', pageLimit: 1 });
    expect(crawlPolicy('https://example.com/tulsa/', 'website')).toMatchObject({ scope: 'website', pageLimit: 25 });
  });
  it('restricts explicitly selected sections with exact path boundaries', () => {
    const target = 'https://example.com/tulsa/', policy = crawlPolicy(target, 'section');
    expect(isCrawlPageAllowed(`${target}services`, target, policy)).toBe(true);
    for (const url of ['https://example.com/tulsa-other', 'https://example.com/other/', 'https://blog.example.com/tulsa/', `${target}a%2fb`, `${target}services?filter=x`, `${target}account/login`]) expect(isCrawlPageAllowed(url, target, policy)).toBe(false);
    const options = crawlTaskOptions(target, '', policy);
    expect(options.custom_robots_txt).toContain('Disallow: /\nAllow: /tulsa$\nAllow: /tulsa/');
    expect(options.custom_robots_txt).toContain('Disallow: /tulsa/*?');
  });
  it('prioritizes only discovered relevant in-scope links, without queries or private flows', () => {
    const target = 'https://example.com/tulsa/';
    const html = ['services', 'about', 'contact?utm_source=x', '../other/services', 'cart', 'news'].map(x => `<a href="${x}">Link</a>`).join('');
    expect(crawlTaskOptions(target, html, crawlPolicy(target, 'section')).priority_urls).toEqual([`${target}services`, `${target}about`]);
  });
  it('normalizes starting tracking URLs and rejects account entry points', () => {
    expect(normalizeCrawlUrl('https://example.com/?utm_source=x#top')).toBe('https://example.com/');
    expect(() => normalizeCrawlUrl('https://example.com/login')).toThrow();
  });
});
