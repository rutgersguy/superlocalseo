import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';

type Business = { businessName: string; googleUrl: string };
export default function ReviewCollection() {
  const { token } = useParams();
  const [business, setBusiness] = useState<Business | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [rating, setRating] = useState<number | null>(null);
  const [message, setMessage] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [consent, setConsent] = useState(false);
  const [website, setWebsite] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const submissionId = useRef(crypto.randomUUID());
  const pending = useRef<object | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    const robots = document.createElement('meta'); robots.name = 'robots'; robots.content = 'noindex, nofollow'; document.head.appendChild(robots);
    setLoading(true); setBusiness(null); setLoadError(''); setSent(false); pending.current = null; submissionId.current = crypto.randomUUID();
    fetch(`/api/collection/${encodeURIComponent(token ?? '')}`, { signal: controller.signal, cache: 'no-store' })
      .then(async r => { if (!r.ok) throw new Error(r.status === 404 ? 'This review link is unavailable. Please contact the business for a current link.' : 'Unable to load this page. Please try again.'); return r.json(); })
      .then(r => setBusiness(r.data)).catch(e => { if (e.name !== 'AbortError') setLoadError(e.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => { controller.abort(); robots.remove(); };
  }, [token]);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); if (busy) return;
    setBusy(true); setError('');
    // Keep the exact request for a retry after a lost response; never create two records.
    pending.current ??= { submissionId: submissionId.current, rating, message, name, email: consent ? email : '', contactConsent: consent, website };
    try {
      const r = await fetch(`/api/collection/${encodeURIComponent(token ?? '')}/feedback`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(pending.current) });
      const result = await r.json();
      if (!r.ok) { if (r.status === 422 || r.status === 400) pending.current = null; throw new Error(result.error?.message ?? 'Unable to submit. Please try again.'); }
      setSent(true);
    } catch(e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <main className="min-h-screen bg-slate-50 px-5 py-10"><div className="mx-auto max-w-xl space-y-7">
    {loading ? <p role="status">Loading review page…</p> : loadError ? <div role="alert"><h1 className="text-2xl font-bold">Review page unavailable</h1><p className="mt-3">{loadError}</p><button onClick={() => window.location.reload()} className="mt-4 underline">Try again</button></div> : business && <>
      <header><p className="text-sm text-slate-600">{business.businessName}</p><h1 className="mt-2 text-3xl font-bold text-slate-900">Share an honest review</h1><p className="mt-3 text-slate-700">Your experience matters. You can leave a public Google review, share private feedback with the business, or do both.</p></header>
      <section aria-label="Public review" className="rounded-xl bg-white p-6 shadow-card"><a href={business.googleUrl} target="_blank" rel="noopener noreferrer" className="block rounded-lg bg-brand-500 px-5 py-3 text-center font-semibold text-white">Leave an honest Google review</a><p className="mt-3 text-sm text-slate-600">Opens Google in a new tab. This option is available regardless of your rating. No private feedback is required.</p></section>
      <section aria-labelledby="private-title" className="rounded-xl bg-white p-6 shadow-card"><h2 id="private-title" className="text-xl font-semibold">Optional private feedback</h2>
        <p className="mt-2 text-sm text-slate-600">Sent to {business.businessName} through SuperLocalSEO. This does not post a Google review. Please leave out sensitive personal information.</p>
        {sent ? <p role="status" className="mt-5 font-medium">Thank you. Your private feedback was received.</p> : <form onSubmit={submit} className="mt-5 space-y-4">
          <fieldset disabled={busy || !!pending.current} className="space-y-4 disabled:opacity-70">
            <fieldset><legend className="mb-2 text-sm font-medium">Rating for private feedback (optional)</legend><div className="flex flex-wrap gap-3">{[1,2,3,4,5].map(n => <label key={n} className="flex items-center gap-1 rounded border border-slate-300 p-2"><input type="radio" name="rating" value={n} checked={rating === n} onChange={() => setRating(n)} />{n} {n === 1 ? 'star' : 'stars'}</label>)}</div><button type="button" onClick={() => setRating(null)} className="mt-2 text-sm underline">Clear rating</button></fieldset>
            <label className="block text-sm font-medium">Your feedback<textarea required maxLength={2000} value={message} onChange={e => setMessage(e.target.value)} className="mt-1 block min-h-28 w-full rounded border border-slate-300 p-2" /></label>
            <label className="block text-sm font-medium">Name (optional)<input maxLength={100} value={name} onChange={e => setName(e.target.value)} className="mt-1 block w-full rounded border border-slate-300 p-2" /></label>
            <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={consent} onChange={e => { setConsent(e.target.checked); if (!e.target.checked) setEmail(''); }} className="mt-1" />I would like the business to contact me by email about this feedback.</label>
            {consent && <label className="block text-sm font-medium">Email for follow-up (optional)<input type="email" maxLength={254} value={email} onChange={e => setEmail(e.target.value)} className="mt-1 block w-full rounded border border-slate-300 p-2" /></label>}
            <div aria-hidden="true" className="hidden"><label>Website<input tabIndex={-1} autoComplete="off" value={website} onChange={e => setWebsite(e.target.value)} /></label></div>
          </fieldset>
          {error && <p role="alert" className="text-sm text-red-700">{error} Retry sends the same feedback.</p>}
          <button disabled={busy} className="rounded-lg border border-slate-400 px-4 py-2 font-medium disabled:opacity-50">{busy ? 'Sending…' : pending.current ? 'Retry private feedback' : 'Send private feedback'}</button>
        </form>}
      </section>
      <footer className="text-sm text-slate-500">Powered by SuperLocalSEO · <a href="/privacy" className="underline">Privacy policy</a></footer>
    </>}
  </div></main>;
}
