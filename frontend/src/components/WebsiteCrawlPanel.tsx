import { useState } from 'react';
import { mutate } from 'swr';
import { apiFetch } from '../services/api';

interface CrawlCheck { key: string; title: string; priority: 'high' | 'medium'; why: string; fix: string; testedPages: number; affectedPages: number; urls: string[]; }
export interface WebsiteCrawl { status: string; data: null | { scope?: string; message?: string; target?: string; fetchedAt?: string; pagesCrawled?: number | null; pagesReturned?: number; pageLimit?: number; checks?: CrawlCheck[]; pages?: Array<{ url: string; title: string | null; statusCode: number | null; issueCount: number }>; }; }
const safeUrl = (url: string) => { try { const u = new URL(url); return ['https:', 'http:'].includes(u.protocol) && !u.username && !u.password ? u.href : undefined; } catch { return undefined; } };
function PageLink({ url }: { url: string }) { const href = safeUrl(url); return href ? <a href={href} target="_blank" rel="noopener noreferrer" className="text-brand-700 underline break-all">{url}</a> : <span className="break-all">{url || 'URL not returned'}</span>; }
export default function WebsiteCrawlPanel({ auditId, crawl, hasWebsite }: { auditId: string; crawl?: WebsiteCrawl; hasWebsite: boolean }) {
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const status = crawl?.status ?? 'not_started';
  const data = crawl?.data;
  const checks = data?.checks ?? [];
  const issues = checks.filter(c => c.affectedPages > 0).sort((a, b) => Number(b.priority === 'high') - Number(a.priority === 'high') || b.affectedPages - a.affectedPages);
  const ready = status === 'complete';
  const start = async () => {
    setStarting(true); setError(null);
    try {
      const response = await apiFetch<{ success: boolean; error?: string | { message?: string } }>(`/audits/bl/${auditId}/crawl`, { method: 'POST' });
      if (!response.success) throw new Error(typeof response.error === 'string' ? response.error : response.error?.message ?? 'Could not start expanded checks.');
      await mutate('/audits/bl');
    } catch (e) { setError((e as Error).message); }
    finally { setStarting(false); }
  };
  return <section className="rounded-xl border border-slate-200 bg-white shadow-card p-6 space-y-4" aria-label="Expanded on-page SEO checks">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 className="text-base font-semibold text-slate-900">On-Page SEO Checks</h2><p className="text-sm text-slate-500 mt-1">Page-by-page findings, affected URLs and practical fixes. Performance remains in the Lighthouse section.</p></div>
      <span className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-700">{ready ? 'Crawl complete' : status === 'not_started' ? 'Expanded checks available' : ['queued', 'submitting', 'running'].includes(status) ? 'Checks in progress' : 'Needs attention'}</span>
    </div>
    {status === 'not_started' && <div className="space-y-2"><p className="text-sm text-slate-600">This older audit has no site crawl. Expanded checks scan up to 100 pages from a website homepage. A saved URL pointing to a specific page is checked as that page, without expanding into unrelated locations on a shared website.</p><button disabled={starting || !hasWebsite} onClick={() => void start()} className="rounded-lg bg-brand-600 px-4 py-2 text-sm text-white disabled:opacity-50">{starting ? 'Starting…' : 'Run expanded SEO checks'}</button>{!hasWebsite && <p className="text-sm text-slate-500">Add your website in Settings first.</p>}</div>}
    {['queued', 'submitting', 'running'].includes(status) && <p role="status" className="text-sm text-slate-600">{status === 'queued' ? 'Waiting for the audit worker. Results update automatically.' : status === 'submitting' ? 'Preparing the website crawl…' : `Crawling your website${data?.pagesCrawled != null ? ` · ${data.pagesCrawled} pages crawled` : ''}. Results update automatically.`}</p>}
    {data?.message && <p role="status" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">{data.message}</p>}
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    {ready && <>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[['Pages reviewed', data?.pagesReturned ?? '—'], ['Issue types found', issues.length], ['Checks with observations', checks.filter(c => c.testedPages > 0).length], ['Crawl page limit', data?.pageLimit ?? 100]].map(([label, value]) => <div key={label} className="rounded-lg bg-slate-50 p-3"><p className="text-xs text-slate-500">{label}</p><p className="text-xl font-semibold text-slate-900">{value}</p></div>)}
      </div>
      {data?.scope === 'saved_page' && <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-700">This audit covers your saved page only. It does not include other locations or pages on the shared website.</p>}
      <p className="text-xs text-slate-500">{data?.fetchedAt ? `Results retrieved ${new Date(data.fetchedAt).toLocaleString()}. ` : ''}These findings cover the pages returned by this crawl, not a guarantee that every page or SEO issue was checked. Crawl limits, access restrictions and robots rules can reduce coverage.</p>
      {data?.target && <p className="text-xs text-slate-500">Website: <PageLink url={data.target} /></p>}
      {!issues.length && <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-700">No issues were reported for the checks with observations on these pages. Unchecked items are listed below.</p>}
      <div className="space-y-3">{issues.map(issue => <details key={issue.key} className="rounded-lg border border-slate-200 p-4">
        <summary className="cursor-pointer text-sm font-semibold text-slate-900">{issue.title} <span className="ml-2 text-xs font-normal text-slate-500">{issue.affectedPages} affected {issue.affectedPages === 1 ? 'page' : 'pages'} · {issue.priority === 'high' ? 'Prioritize' : 'Review'}</span></summary>
        <div className="mt-3 space-y-3 text-sm text-slate-700"><p>{issue.why}</p><div className="rounded-lg bg-brand-50 p-3"><h3 className="font-semibold mb-1">How to fix it</h3><p>{issue.fix}</p></div><h3 className="font-semibold">Affected pages</h3><ul className="space-y-1">{issue.urls.map(url => <li key={url}><PageLink url={url} /></li>)}</ul><p className="text-xs text-slate-500">This check returned an observation on {issue.testedPages} pages.</p></div>
      </details>)}</div>
      <details className="rounded-lg border border-slate-200 p-4"><summary className="cursor-pointer text-sm font-semibold text-slate-900">All checks and coverage</summary><ul className="mt-3 space-y-2 text-sm text-slate-700">{checks.map(c => <li key={c.key}><span className="font-medium">{c.title}</span> — {c.testedPages === 0 ? 'Not checked: no observation returned' : `${c.affectedPages} affected / ${c.testedPages} checked pages`}</li>)}</ul></details>
      <details className="rounded-lg border border-slate-200 p-4"><summary className="cursor-pointer text-sm font-semibold text-slate-900">Pages reviewed</summary><div className="overflow-x-auto mt-3"><table className="w-full text-left text-sm"><thead><tr><th className="p-2">Page</th><th className="p-2">HTTP status</th><th className="p-2">Issue types</th></tr></thead><tbody>{data?.pages?.map(p => <tr key={p.url} className="border-t border-slate-100"><td className="p-2"><p>{p.title ?? 'Title not returned'}</p><PageLink url={p.url} /></td><td className="p-2">{p.statusCode ?? 'Not returned'}</td><td className="p-2">{p.issueCount}</td></tr>)}</tbody></table></div></details>
    </>}
  </section>;
}
