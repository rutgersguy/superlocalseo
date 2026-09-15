export const CRAWL_PAGE_LIMIT = 25;
export const CRAWL_MAX_DEPTH = 3;
const excluded = /\/(?:search|login|log-in|signin|sign-in|signup|register|account|my-account|cart|checkout|filter|filters|wp-admin|wp-login\.php)(?:\/|$)/i;
const excludedSegments = ['search', 'login', 'log-in', 'signin', 'sign-in', 'signup', 'register', 'account', 'my-account', 'cart', 'checkout', 'filter', 'filters', 'wp-admin', 'wp-login.php'];
export interface CrawlPolicy { version: number; pageLimit: number; maxDepth: number | null; scope: 'website' | 'url_section' | 'saved_page'; scopePath: string; }
export function normalizeCrawlUrl(value: string): string {
  const u = new URL(value); u.search = ''; u.hash = '';
  if (!['https:', 'http:'].includes(u.protocol) || u.username || u.password || excluded.test(u.pathname)) throw new Error('Unsupported crawl URL');
  return u.href;
}
export function crawlPolicy(value: string, mode = 'auto'): CrawlPolicy {
  const path = new URL(value).pathname.replace(/\/+$/, '') || '/';
  const single = mode === 'page' || (mode === 'auto' && path !== '/');
  const whole = mode === 'website' || (mode === 'auto' && path === '/') || (mode === 'section' && path === '/');
  return { version: 2, pageLimit: single ? 1 : CRAWL_PAGE_LIMIT, maxDepth: CRAWL_MAX_DEPTH,
    scope: whole ? 'website' : single ? 'saved_page' : 'url_section', scopePath: whole ? '/' : path };
}
export function isCrawlPageAllowed(value: string, target: string, policy: CrawlPolicy): boolean {
  try {
    const u = new URL(value), start = new URL(target);
    if (u.origin !== start.origin || u.search || u.hash || u.username || u.password || excluded.test(decodeURIComponent(u.pathname)) || /%2f|%5c/i.test(u.pathname)) return false;
    const path = u.pathname.replace(/\/+$/, '') || '/';
    return policy.scope === 'website' || path === policy.scopePath || (policy.scope === 'url_section' && path.startsWith(`${policy.scopePath}/`));
  } catch { return false; }
}
export function crawlTaskOptions(target: string, html: string, policy = crawlPolicy(target)) {
  const base = policy.scopePath === '/' ? '' : policy.scopePath;
  // Longer scoped rules outrank the location-section Allow rule. Merge preserves site robots restrictions.
  const rules = policy.scope === 'website' ? [] : ['Disallow: /', `Allow: ${base}$`, ...(policy.scope === 'url_section' ? [`Allow: ${base}/`] : [])];
  rules.push(`Disallow: ${base}/*?`, `Disallow: ${base}?`);
  for (const segment of excludedSegments) rules.push(`Disallow: ${base}/${segment}`, `Disallow: ${base}/*/${segment}`);
  const candidates = new Set<string>();
  for (const match of html.matchAll(/<a\b[^>]*\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)) {
    try {
      const raw = new URL((match[1] ?? match[2] ?? match[3]).replace(/&amp;/gi, '&'), target);
      // Never enqueue query/filter variants, even when they point to an otherwise useful page.
      if (!isCrawlPageAllowed(raw.href, target, policy)) continue;
      candidates.add(raw.href);
    } catch { /* Ignore malformed links. */ }
  }
  const priority = [...candidates].filter(u => /\/(?:[^/]*(?:service|location|contact|about)[^/]*)(?:\/|$)/i.test(new URL(u).pathname)).slice(0, 20);
  return { max_crawl_pages: policy.pageLimit, max_crawl_depth: policy.maxDepth, respect_sitemap: false,
    allow_subdomains: false, custom_robots_txt: rules.join('\n'), robots_txt_merge_mode: 'merge',
    ...(priority.length ? { priority_urls: priority } : {}) };
}
