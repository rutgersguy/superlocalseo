import { useState } from 'react';
import useSWR from 'swr';
import { apiFetch, fetcher } from '../services/api';
type Location = { locationId: string; name: string; ready: boolean; state: string; url: string | null; googleUrl: string | null };
export default function ReviewCollectionLinks() {
  const { data, error, mutate } = useSWR<{ data: { locations: Location[]; canManage: boolean } }>('/campaigns/collection', fetcher);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  async function action(l: Location, action: 'create' | 'rotate' | 'revoke') {
    if (action !== 'create' && !window.confirm(action === 'revoke' ? 'Disable this review link? Printed QR codes using it will stop working.' : 'Replace this review link? All copies and printed QR codes using the old link will stop working.')) return;
    setBusy(l.locationId); setMessage('');
    try { const result = await apiFetch<{ success: boolean; error?: { message?: string } }>(`/campaigns/collection/${l.locationId}`, { method: 'POST', body: JSON.stringify({ action }) }); if (!result.success) throw new Error(result.error?.message || 'Unable to update this link.'); await mutate(); setMessage(action === 'revoke' ? 'Review link disabled.' : 'Review link ready. Preview it before sharing.'); } catch(e) { setMessage((e as Error).message); } finally { setBusy(''); }
  }
  async function download(l: Location) {
    setBusy(l.locationId); setMessage('');
    try {
      const r = await apiFetch<Response>(`/campaigns/collection/${l.locationId}/qr.png`, {}, true);
      if (!r.ok) throw new Error('Unable to download the QR code. Refresh the page and check the link status.');
      const url = URL.createObjectURL(await r.blob()); const a = document.createElement('a'); a.href = url; a.download = 'honest-review-qr.png'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch(e) { setMessage((e as Error).message); } finally { setBusy(''); }
  }
  return <section aria-labelledby="review-links-title" className="rounded-xl bg-white p-5 shadow-card space-y-4">
    <h2 id="review-links-title" className="text-lg font-semibold">Review links and QR codes</h2>
    <p className="text-sm text-slate-600">Share an honest-review page with an optional private feedback form. Google reviews are equally available at every rating.</p>
    <p className="text-sm text-slate-600">These links are for direct sharing and printed QR codes. Existing email and SMS campaigns keep their verified provider destination until support confirms that channel can use this page.</p>
    {error && <p role="alert" className="text-red-700">Unable to load review links. Refresh to retry.</p>}
    {!data && !error && <p role="status">Loading review links…</p>}
    {data?.data.locations.length === 0 && <p>Add a business location in Settings to get started.</p>}
    {data?.data.locations.map(l => <div key={l.locationId} className="border-t border-slate-200 pt-4 space-y-2">
      <h3 className="font-medium">{l.name}</h3>
      {!l.ready && <p className="text-sm text-amber-800">Support must verify this business in Provider mappings before a review link can be issued.</p>}
      {l.state === 'needs_verification' && <p className="text-sm text-amber-800">Business details changed. The old link is unavailable. Verify the destination and create a replacement.</p>}
      {l.state === 'revoked' && <p className="text-sm text-slate-600">This link is disabled. Previous QR codes no longer work.</p>}
      {l.googleUrl && <a href={l.googleUrl} target="_blank" rel="noopener noreferrer" className="block text-sm underline">Check Google destination</a>}
      {l.url && <><label className="block text-sm">Review link<input readOnly value={l.url} onFocus={e => e.target.select()} className="mt-1 block w-full rounded border border-slate-300 p-2" /></label><div className="flex flex-wrap gap-4 text-sm"><a href={l.url} target="_blank" rel="noopener noreferrer" className="underline">Preview review page</a><button disabled={!!busy} onClick={() => void download(l)} className="underline">Download QR code</button></div></>}
      {data.data.canManage && <div className="flex flex-wrap gap-4 text-sm">
        {l.ready && <button disabled={!!busy} onClick={() => void action(l, l.state === 'not_created' ? 'create' : 'rotate')} className="rounded border border-slate-300 px-3 py-2">{l.state === 'not_created' ? 'Create review link' : 'Create replacement link'}</button>}
        {l.state !== 'not_created' && l.state !== 'revoked' && <button disabled={!!busy} onClick={() => void action(l, 'revoke')} className="underline">Disable link</button>}
      </div>}
    </div>)}
    {message && <p role="status" className="text-sm">{message}</p>}
  </section>;
}
