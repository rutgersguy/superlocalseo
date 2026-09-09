import { FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import useSWR from 'swr';
import { fetcher } from '../services/api';
interface ReportRow {
  id: string; businessName: string; email: string | null; city: string; keyword: string | null;
  createdAt: string; updatedAt: string; generatedAt: string | null; status: string; emailStatus: string;
  stale: boolean; needsAttention: boolean; hasSnapshot: boolean; checked: number | null; unavailable: number | null;
  error: string | null; consentAt: string | null; consentVersion: string | null;
}
const stamp = (value: string | null) => value ? new Date(value).toLocaleString() : 'Not recorded';
const emailLabels: Record<string, string> = { accepted: 'Accepted by email provider', pending: 'Pending', failed: 'Acceptance not confirmed', not_recorded: 'Not recorded' };
export default function AdminFreeReports() {
  const [page, setPage] = useState(1);
  const [draft, setDraft] = useState(''); const [search, setSearch] = useState(''); const [status, setStatus] = useState('all');
  const query = new URLSearchParams({ page: String(page), search, status });
  const { data, error, isLoading, isValidating, mutate } = useSWR<{ data: { reports: ReportRow[]; total: number; hasMore: boolean } }>(`/admin/free-reports?${query}`, fetcher, { refreshInterval: 30000 });
  function submit(e: FormEvent) { e.preventDefault(); setPage(1); setSearch(draft.trim()); }
  return <section className="space-y-4" aria-labelledby="free-reports-title">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 id="free-reports-title" className="text-lg font-semibold text-slate-900">Free report leads</h2><button className="text-sm underline disabled:opacity-50" disabled={isValidating} onClick={() => void mutate()}>{isValidating ? 'Refreshing…' : 'Refresh reports'}</button></div>
    <p className="text-sm text-slate-600">Native free-report submissions, newest first. Email acceptance does not confirm delivery or that the recipient opened the report. These requests consent to report delivery only, not marketing.</p>
    <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
      <label className="w-full sm:flex-1 sm:w-auto min-w-0 text-sm font-medium">Search reports<input className="mt-1 block w-full rounded-lg border-slate-300" value={draft} maxLength={100} onChange={e => setDraft(e.target.value)} placeholder="Business, email, city, keyword or report ID" /></label>
      <button className="rounded-lg bg-slate-800 px-4 py-2 text-white" type="submit">Search</button>
      <label className="text-sm font-medium">Report status<select aria-label="Report status" className="mt-1 block rounded-lg border-slate-300" value={status} onChange={e => { setStatus(e.target.value); setPage(1); }}>{[['all','All reports'],['attention','Needs attention'],['queued','Queued'],['processing','Processing'],['completed','Completed'],['failed','Failed']].map(([v,l]) => <option key={v} value={v}>{l}</option>)}</select></label>
    </form>
    {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-red-800">Could not load reports. Use Refresh reports to try again.</p>}
    {isLoading && <p role="status">Loading reports…</p>}
    {!error && data?.data.reports.length === 0 && <p>No reports match these filters.</p>}
    {!error && data?.data.reports.map(r => <article key={r.id} className="rounded-xl border border-slate-200 p-4 space-y-3 break-words">
      <div className="flex flex-wrap justify-between items-start gap-3"><div><h3 className="font-semibold text-slate-900">{r.businessName}</h3><p className="text-sm text-slate-600">{r.city} · {r.keyword ?? 'No search phrase recorded'}</p></div><span className={`rounded-full px-3 py-1 text-xs font-medium ${r.needsAttention ? 'bg-amber-100 text-amber-900' : 'bg-slate-100 text-slate-700'}`}>{r.status}{r.stale ? ' · Stalled' : ''}{!r.stale && r.needsAttention ? ' · Needs attention' : ''}</span></div>
      <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3"><div><dt className="text-slate-500">Lead email</dt><dd>{r.email ?? 'Not recorded'}</dd></div><div><dt className="text-slate-500">Requested</dt><dd>{stamp(r.createdAt)}</dd></div><div><dt className="text-slate-500">Report email</dt><dd>{emailLabels[r.emailStatus] ?? 'Unknown'}</dd></div><div><dt className="text-slate-500">Last update</dt><dd>{stamp(r.updatedAt)}</dd></div><div><dt className="text-slate-500">Report completed</dt><dd>{stamp(r.generatedAt)}</dd></div>{r.hasSnapshot && <div><dt className="text-slate-500">Search observations</dt><dd>{r.checked ?? 'Unknown'} checked · {r.unavailable ?? 'Unknown'} unavailable</dd></div>}</dl>
      {r.error && <p className="text-sm text-amber-900">{r.error}</p>}
      {r.stale && <p className="text-sm text-amber-900">No update for over 15 minutes. Check the report worker and queue before retrying; a new request can purchase another scan.</p>}
      {r.emailStatus === 'failed' && <p className="text-sm text-amber-900">The report remains available. Check the email provider receipt before attempting another send to avoid duplicate delivery.</p>}
      <div className="flex flex-wrap gap-4 text-sm"><Link className="font-medium text-brand-700 underline" to={`/free-report/${r.id}`} target="_blank" rel="noreferrer">{r.hasSnapshot ? 'Open report' : 'Open report status'}</Link><details><summary className="cursor-pointer text-slate-600">Request details</summary><p className="mt-2">Report ID: {r.id}<br />Report-only consent: {stamp(r.consentAt)}<br />Consent version: {r.consentVersion ?? 'Not recorded'}</p></details></div>
    </article>)}
    <div className="flex flex-wrap gap-4 items-center text-sm"><button disabled={page === 1 || isLoading} onClick={() => setPage(p => p - 1)} className="underline disabled:opacity-40">Previous</button><span>Page {page} · {error ? 'Unavailable' : data?.data.total ?? '…'} {data?.data.total === 1 ? 'report' : 'reports'}</span><button disabled={!!error || !data?.data.hasMore || isLoading} onClick={() => setPage(p => p + 1)} className="underline disabled:opacity-40">Next</button></div>
  </section>;
}
