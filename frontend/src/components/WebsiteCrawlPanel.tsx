import { useEffect, useState } from 'react';
import useSWR, { mutate } from 'swr';
import { apiFetch, fetcher } from '../services/api';

interface CrawlCheck { key: string; title: string; priority: 'high' | 'medium'; why: string; fix: string; testedPages: number; affectedPages: number; urls: string[]; }
export interface WebsiteCrawl { status: string; data: null | { scope?: string; maxDepth?: number; message?: string; target?: string; fetchedAt?: string; pagesCrawled?: number | null; pagesReturned?: number; pageLimit?: number; checks?: CrawlCheck[]; pages?: Array<{ url: string; title: string | null; statusCode: number | null; issueCount: number }>; }; }
const safeUrl = (url: string) => { try { const u = new URL(url); return ['https:', 'http:'].includes(u.protocol) && !u.username && !u.password ? u.href : undefined; } catch { return undefined; } };
function PageLink({ url }: { url: string }) { const href = safeUrl(url); return href ? <a href={href} target="_blank" rel="noopener noreferrer" className="text-brand-700 underline break-all">{url}</a> : <span className="break-all">{url || 'URL not returned'}</span>; }
export default function WebsiteCrawlPanel({ auditId, crawl, hasWebsite }: { auditId: string; crawl?: WebsiteCrawl; hasWebsite: boolean }) {
  const scopeKey = `/audits/bl/${auditId}/crawl-scope`;
  const { data: scopeResponse, mutate: refreshScope } = useSWR<any>(scopeKey, fetcher);
  const [scopeChoice, setScopeChoice] = useState<string | null>(null);
  const [scopeMessage, setScopeMessage] = useState('');
  useEffect(() => { setScopeChoice(null); setScopeMessage(''); }, [auditId]);
  const [savingScope, setSavingScope] = useState(false);
  const saveScope = async () => {
    setSavingScope(true); setScopeMessage('');
    try {
      const result = await apiFetch<{ success: boolean }>(scopeKey, { method: 'PUT', body: JSON.stringify({ scope: scopeChoice ?? scopeResponse?.data?.scope ?? 'auto' }) });
      if (!result.success) throw new Error('Save failed');
      await refreshScope(); setScopeMessage('Saved for the next crawl. Existing results are unchanged.');
    } catch { setScopeMessage('Could not save the crawl scope. Please try again.'); }
    finally { setSavingScope(false); }
  };
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
    <details className="rounded-lg border border-slate-200 p-3"><summary className="cursor-pointer text-sm font-semibold">Crawl scope and limits</summary>
      <p className="mt-2 text-sm text-slate-600">Automatic checks run at onboarding and monthly, up to 25 pages and three links deep. Service, location, contact and about links are prioritized; query-string URLs and search, filter, account and cart pages are excluded.</p>
      <p className="mt-2 text-sm text-slate-600">A website may serve several locations without separate sections. Choose Website to check the broader site; those findings are not location-specific. URL section includes only the saved path and its subpages. Automatic uses the website for a homepage URL, or just the saved page otherwise.</p>
      {scopeResponse?.data?.website && <p className="my-2 text-xs">Saved website: <PageLink url={scopeResponse.data.website} /></p>}
      <label className="block mt-3 text-sm">Scope for future crawls<select aria-label="Scope for future crawls" className="block border rounded p-2 mt-1" value={scopeChoice ?? scopeResponse?.data?.scope ?? 'auto'} onChange={e => setScopeChoice(e.target.value)}>
        <option value="auto">Automatic (conservative default)</option><option value="website">Website (may cover multiple locations)</option><option value="section">Saved URL section and subpages</option><option value="page">Saved page only</option>
      </select></label>
      <button onClick={() => void saveScope()} disabled={savingScope || !scopeResponse?.success} className="mt-3 rounded bg-brand-600 text-white px-3 py-2 text-sm disabled:opacity-50">{savingScope ? 'Saving…' : 'Save crawl scope'}</button>
      {scopeMessage && <p role="status" className="mt-2 text-sm">{scopeMessage}</p>}
    </details>
    {status === 'not_started' && <div className="space-y-2"><p className="text-sm text-slate-600">Expanded checks run at onboarding and monthly, up to 25 pages and three links deep. We prioritize service, location, contact and about links, skip search/filter, account and cart pages, and exclude query-string duplicates. The scope below controls which part of the website is checked. You can add these checks to this older audit now.</p><button disabled={starting || !hasWebsite} onClick={() => void start()} className="rounded-lg bg-brand-600 px-4 py-2 text-sm text-white disabled:opacity-50">{starting ? 'Starting…' : 'Run expanded SEO checks'}</button>{!hasWebsite && <p className="text-sm text-slate-500">Add your website in Settings first.</p>}</div>}
    {['queued', 'submitting', 'running'].includes(status) && <p role="status" className="text-sm text-slate-600">{status === 'queued' ? 'Waiting for the audit worker. Results update automatically.' : status === 'submitting' ? 'Preparing the website crawl…' : `Crawling your website${data?.pagesCrawled != null ? ` · ${data.pagesCrawled} pages crawled` : ''}. Results update automatically.`}</p>}
    {data?.message && <p role="status" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">{data.message}</p>}
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    {ready && <>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[['Pages reviewed', data?.pagesReturned ?? '—'], ['Issue types found', issues.length], ['Checks with observations', checks.filter(c => c.testedPages > 0).length], ['Crawl page limit', data?.pageLimit ?? '—']].map(([label, value]) => <div key={label} className="rounded-lg bg-slate-50 p-3"><p className="text-xs text-slate-500">{label}</p><p className="text-xl font-semibold text-slate-900">{value}</p></div>)}
      </div>
      {data?.maxDepth != null && <p className="text-xs text-slate-500">Crawl depth limit: {data.maxDepth} links from the starting page.</p>}
      {data?.scope === 'url_section' && <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-700">This audit covers the selected URL section and its subpages. A URL section is not necessarily specific to one business location.</p>}
      {data?.scope === 'saved_page' && <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-700">This audit covers your saved page only. It does not assess the rest of the website.</p>}
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
