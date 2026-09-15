import { config } from '../config';
import { db } from '../db/connection';
import { fetchPublicWebsite } from './public_website_fetch';
import { logger } from '../utils/logger';

export const CRAWL_PAGE_LIMIT = 100;
// A saved branch/page URL on a shared domain must not expand into other businesses.
export function crawlPageLimit(target: string): number {
  return new URL(target).pathname.replace(/\/+$/, '') ? 1 : CRAWL_PAGE_LIMIT;
}
type Rule = { key: string; scope: 'checks' | 'page'; title: string; priority: 'high' | 'medium'; why: string; fix: string };
export const CRAWL_RULES: Rule[] = [
  { key: 'is_4xx_code', scope: 'checks', title: 'Pages return a client error', priority: 'high', why: 'Visitors and crawlers cannot access these URLs normally.', fix: 'Restore pages that should exist. Update internal links to the correct URL. For permanently moved content, add a single 301 redirect to the closest relevant replacement; intentional removed pages can remain 404 or 410.' },
  { key: 'is_5xx_code', scope: 'checks', title: 'Pages return a server error', priority: 'high', why: 'The server could not serve these pages during the crawl.', fix: 'Ask your host or developer to inspect server logs for these URLs. Repair application errors, resource limits or proxy failures, then retest the URLs before another crawl.' },
  { key: 'broken_links', scope: 'page', title: 'Pages contain broken links', priority: 'high', why: 'Links on these pages lead to destinations that the crawler could not retrieve successfully.', fix: 'Open each affected page and check its internal and external links. Replace incorrect destinations, remove obsolete links, or restore the destination page. Check whether temporary blocking caused the failure before deleting a valid link.' },
  { key: 'broken_resources', scope: 'page', title: 'Pages have unavailable resources', priority: 'high', why: 'Missing images, styles or scripts can prevent a page from displaying or functioning correctly.', fix: 'Use your browser’s Network panel on each page to find failed image, CSS and JavaScript requests. Correct their paths or restore the files, and check CDN or access restrictions.' },
  { key: 'duplicate_title', scope: 'page', title: 'Duplicate page titles', priority: 'medium', why: 'Identical titles make distinct pages harder to distinguish in search results.', fix: 'Write a unique, descriptive title for each distinct page in your CMS SEO settings. If the URLs contain the same content, review canonical URLs or redirects instead of inventing separate titles for duplicate pages.' },
  { key: 'duplicate_description', scope: 'page', title: 'Duplicate meta descriptions', priority: 'medium', why: 'Distinct pages may present the same summary to search engines.', fix: 'Give each important page a relevant description of its own content. Do not change descriptions simply to differentiate URLs that should instead be consolidated.' },
  { key: 'duplicate_content', scope: 'page', title: 'Potential duplicate content', priority: 'medium', why: 'The crawler found substantially similar content; this needs a review, not an automatic penalty assumption.', fix: 'Compare the affected pages. Keep useful variations where needed; for duplicate URL versions, choose a preferred canonical URL or redirect redundant pages. Update internal links to the preferred version.' },
  { key: 'no_title', scope: 'checks', title: 'Missing page titles', priority: 'medium', why: 'The page lacks a title describing its purpose.', fix: 'Set a meaningful title in the page’s SEO settings or HTML <title> element. Describe the actual service or content; include the location only where relevant.' },
  { key: 'no_description', scope: 'checks', title: 'Missing meta descriptions', priority: 'medium', why: 'A useful search-result summary has not been supplied. Search engines may still generate their own.', fix: 'Add a concise, page-specific meta description in your CMS. Explain the page’s value naturally; a description does not guarantee which text Google will display.' },
  { key: 'no_h1_tag', scope: 'checks', title: 'Missing main headings', priority: 'medium', why: 'A clear main heading helps people understand a page’s topic.', fix: 'Add a visible, descriptive H1 to the page template or content. Use a natural heading that matches the page’s purpose, rather than a list of keywords.' },
  { key: 'no_image_alt', scope: 'checks', title: 'Images need alternative-text review', priority: 'medium', why: 'Some images lack alternative text that could help screen-reader users.', fix: 'Add concise alt text to informative images. Decorative images should use an empty alt attribute. Avoid keyword stuffing, and check the actual images before making changes.' },
  { key: 'https_to_http_links', scope: 'checks', title: 'Secure pages link to HTTP URLs', priority: 'medium', why: 'Links may send visitors to an insecure version of a destination.', fix: 'Check that each destination supports HTTPS, then update the link. Do not change an external URL to HTTPS without confirming that it works.' },
  { key: 'recursive_canonical', scope: 'checks', title: 'Canonical reference loops', priority: 'high', why: 'A loop makes the intended preferred URL unclear.', fix: 'Review canonical tags on the affected URLs and point alternate versions directly to one accessible, indexable preferred page. Remove circular canonical references.' },
];
const finite = (n: unknown): number | null => typeof n === 'number' && Number.isFinite(n) ? n : null;
export function summarizeCrawl(summary: any, pages: any[], target: string) {
  const html = pages.filter(p => p && ['html', 'broken'].includes(p.resource_type));
  const checks = CRAWL_RULES.map(rule => {
    const tested = html.filter(p => typeof (rule.scope === 'page' ? p[rule.key] : p.checks?.[rule.key]) === 'boolean');
    const affected = tested.filter(p => (rule.scope === 'page' ? p[rule.key] : p.checks?.[rule.key]) === true);
    return { ...rule, testedPages: tested.length, affectedPages: affected.length,
      urls: affected.map(p => p.url).filter((u): u is string => typeof u === 'string') };
  });
  return { target, fetchedAt: new Date().toISOString(), pageLimit: crawlPageLimit(target),
    scope: crawlPageLimit(target) === 1 ? 'saved_page' : 'website',
    pagesCrawled: finite(summary.crawl_status?.pages_crawled), pagesReturned: html.length,
    pagesInQueue: finite(summary.crawl_status?.pages_in_queue),
    checks, pages: html.map(p => ({ url: typeof p.url === 'string' ? p.url : '',
      title: typeof p.meta?.title === 'string' ? p.meta.title : null, statusCode: finite(p.status_code),
      issueCount: checks.filter(c => c.urls.includes(p.url)).length })),
  };
}
async function provider(path: string, body?: unknown): Promise<any> {
  const response = await fetch(`https://api.dataforseo.com/v3/on_page/${path}`, {
    method: body ? 'POST' : 'GET', signal: AbortSignal.timeout(20000),
    headers: { Authorization: `Basic ${Buffer.from(`${config.dataforseo.login}:${config.dataforseo.password}`).toString('base64')}`, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) throw new Error(`Crawler provider HTTP ${response.status}`);
  const data = await response.json() as any;
  const task = data.tasks?.[0];
  if (data.status_code !== 20000 || !task || ![20000, 20100, 40601, 40602].includes(task.status_code)) throw new Error(`Crawler provider task status ${task?.status_code ?? data.status_code}`);
  return task;
}

/** Durable intent precedes the paid API call. Uncertain submissions are never automatically repeated. */
export async function pollWebsiteCrawls(): Promise<void> {
  if (!config.dataforseo.login || !config.dataforseo.password) return;
  const waiting = await db('location_audits').where({ crawl_status: 'queued' }).orderBy('created_at').limit(5);
  for (const audit of waiting) {
    const claimed = await db('location_audits').where({ id: audit.id, crawl_status: 'queued' })
      .update({ crawl_status: 'submitting', crawl_started_at: new Date() });
    if (!claimed) continue;
    let dispatched = false;
    try {
      const location = await db('locations').where({ id: audit.location_id, client_id: audit.client_id }).first();
      const client = await db('clients').where({ id: audit.client_id }).first();
      if (!location?.website || !['active', 'trialing'].includes(client?.subscription_status) || client.product_line !== 'pro' || (client.subscription_status === 'trialing' && client.trial_ends_at && new Date(client.trial_ends_at) < new Date())) {
        await db('location_audits').where({ id: audit.id }).update({ crawl_status: 'unavailable', crawl_data: JSON.stringify({ message: 'A saved website and eligible Pro account are required for the expanded crawl.' }) }); continue;
      }
      const input = location.website.includes('://') ? location.website : `https://${location.website}`;
      const checked = await fetchPublicWebsite(input);
      if (!checked.ok) throw new Error('Website could not be reached for crawling. Check the saved URL and access restrictions.');
      const url = new URL(checked.url);
      const reuse = await db.transaction(async trx => {
        await trx('locations').where({ id: audit.location_id }).forUpdate().first();
        const prior = await trx('location_audits').where({ location_id: audit.location_id, client_id: audit.client_id, crawl_url: url.href })
          .whereNot('id', audit.id).whereIn('crawl_status', ['submitting', 'running', 'complete', 'needs_review'])
          .where('crawl_started_at', '>', new Date(Date.now() - 86400000)).orderBy('crawl_started_at', 'desc').first();
        if (prior) {
          await trx('location_audits').where({ id: audit.id }).update(prior.crawl_status === 'submitting'
            ? { crawl_status: 'queued', crawl_started_at: null }
            : { crawl_status: prior.crawl_status, crawl_task_id: prior.crawl_task_id, crawl_data: prior.crawl_data,
              crawl_url: prior.crawl_url, crawl_started_at: prior.crawl_started_at });
          return true;
        }
        await trx('location_audits').where({ id: audit.id }).update({ crawl_url: url.href });
        return false;
      });
      if (reuse) continue;
      dispatched = true;
      const task = await provider('task_post', [{ target: url.hostname.replace(/^www\./, ''), start_url: url.href,
        max_crawl_pages: crawlPageLimit(url.href), load_resources: true, enable_javascript: true,
        allow_subdomains: false, tag: `sls-audit-${audit.id}` }]);
      if (!task.id || task.status_code !== 20100) throw new Error('Crawl acceptance could not be confirmed.');
      await db('location_audits').where({ id: audit.id }).update({ crawl_status: 'running', crawl_task_id: task.id });
    } catch (error) {
      logger.warn('Website crawl submission stopped', { auditId: audit.id, dispatched, error: (error as Error).message });
      await db('location_audits').where({ id: audit.id }).update({ crawl_status: dispatched ? 'needs_review' : 'unavailable',
        crawl_data: JSON.stringify({ message: dispatched ? 'Crawl acceptance needs review. No automatic repeat purchase will be made.' : 'The saved website could not be reached safely. Check its URL and access restrictions.' }) });
    }
  }
  await db('location_audits').where({ crawl_status: 'submitting' }).where('crawl_started_at', '<', new Date(Date.now() - 3600000))
    .update({ crawl_status: 'needs_review', crawl_data: JSON.stringify({ message: 'The crawl submission was interrupted. Its acceptance needs review before another purchase.' }) });
  const running = await db('location_audits').where({ crawl_status: 'running' }).whereNotNull('crawl_task_id').limit(10);
  for (const audit of running) {
    try {
      if (Date.now() - new Date(audit.crawl_started_at).getTime() > 86400000) throw new Error('Crawl result deadline exceeded.');
      const task = await provider(`summary/${encodeURIComponent(audit.crawl_task_id)}`);
      const summary = task.result?.[0];
      if (!summary) continue;
      if (summary.crawl_progress !== 'finished') {
        await db('location_audits').where({ id: audit.id, crawl_status: 'running' }).update({ crawl_data: JSON.stringify({ target: audit.crawl_url, pagesCrawled: finite(summary.crawl_status?.pages_crawled), pageLimit: crawlPageLimit(audit.crawl_url) }) }); continue;
      }
      const result = await provider('pages', [{ id: audit.crawl_task_id, limit: CRAWL_PAGE_LIMIT, offset: 0 }]);
      const pageResult = result.result?.[0];
      const pages = pageResult?.items ?? (pageResult?.total_items_count === 0 ? [] : null);
      if (!Array.isArray(pages)) throw new Error('Crawl page results are not available yet.');
      const data = summarizeCrawl(summary, pages, audit.crawl_url);
      await db('location_audits').where({ id: audit.id, crawl_status: 'running' }).update({
        crawl_status: data.pagesReturned ? 'complete' : 'unavailable',
        crawl_data: JSON.stringify(data.pagesReturned ? data : { ...data, message: 'No readable pages were returned. The website may block crawling or have no accessible pages. No SEO verdict is available.' }),
      });
    } catch (error) {
      logger.warn('Website crawl results pending', { auditId: audit.id, error: (error as Error).message });
      if (Date.now() - new Date(audit.crawl_started_at).getTime() > 86400000) {
        await db('location_audits').where({ id: audit.id }).update({ crawl_status: 'needs_review', crawl_data: JSON.stringify({ message: 'Crawl results could not be retrieved after 24 hours. The existing task needs review; no new crawl was purchased.' }) });
      }
    }
  }
}
