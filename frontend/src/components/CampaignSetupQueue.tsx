import { useState } from 'react';
import useSWR from 'swr';
import { apiFetch, fetcher } from '../services/api';
interface SetupRow { status: string; revision: number; googlePlaceId: string | null; locationCount: number; verifiedAt: string | null; events: Array<{ revision: number; status: string; note: string; actorId: string | null; createdAt: string; verification: { campaignId: string; googlePlaceId: string; templateVersion: string; verifiedAt: string } | null }>;  id: string; requestedAt: string; businessName: string; locationName: string; city: string | null; organizationId: number | null; providerLocationId: number | null; campaigns: Array<{ name: string; providerId: string; lastSyncAt: string | null }> }
const checks = { identity: 'I matched this campaign to the business and provider location above.', equalAccess: 'All ratings offer the same public-review link and prominence.', optionalFeedback: 'Private feedback is optional and does not block public reviews.', sender: 'The email sender and reply-to details belong to this business.', optOut: 'Opt-out and duplicate handling are configured.', schedule: 'The send window and conservative follow-up schedule are configured.', noEnrollment: 'Applying this template did not enroll contacts or send messages.' };
function VerificationForm({ row, onSaved }: { row: SetupRow; onSaved: () => Promise<unknown> }) {
  const [status, setStatus] = useState('in_progress'); const [note, setNote] = useState('');
  const [campaignId, setCampaignId] = useState(''); const [placeId, setPlaceId] = useState('');
  const [proof, setProof] = useState<Record<string, boolean>>({}); const [busy, setBusy] = useState(false); const [message, setMessage] = useState('');
  async function save(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setMessage('');
    try {
      const result = await apiFetch<{ success: boolean; error?: { message: string } }>(`/admin/campaign-setup/${row.id}`, { method: 'PATCH', body: JSON.stringify({ revision: row.revision, status, note,
        ...(status === 'verified' ? { proof: { ...proof, campaignId, googlePlaceId: placeId, templateVersion: 'honest-email-v1' } } : {}) }) });
      if (!result.success) throw new Error(result.error?.message ?? 'Could not save setup record');
      await onSaved(); setMessage('Setup record saved. No messages were sent.');
    } catch (e) { setMessage((e as Error).message); } finally { setBusy(false); }
  }
  return <details className="text-sm"><summary className="cursor-pointer font-medium">Update setup / record verification</summary>
    <form onSubmit={save} className="mt-3 space-y-3">
      <label className="block">New setup status<select aria-label="New setup status" value={status} onChange={e => setStatus(e.target.value)} className="block w-full rounded-lg border-slate-300"><option value="in_progress">In progress</option><option value="blocked">Blocked</option><option value="requested">Reopen request</option><option value="verified">Record email setup verification</option></select></label>
      {status === 'verified' && <>
        <p>Template: honest-email-v1. Verification records your inspection at this time; it does not prove delivery or automatically detect changes made in the provider dashboard.</p>
        {row.locationCount !== 1 && <p role="alert">Multi-location mapping is not yet supported for verification. Record a blocked status and the required reconciliation.</p>}
        {!row.googlePlaceId && <p role="alert">This location needs its Google place ID saved before it can be verified.</p>}
        <label className="block">Verified campaign<select aria-label="Verified campaign" required value={campaignId} onChange={e => setCampaignId(e.target.value)} className="block w-full rounded-lg border-slate-300"><option value="">Select a synced campaign</option>{row.campaigns.map(c => <option key={c.providerId} value={c.providerId}>{c.name} — {c.providerId}</option>)}</select></label>
        <label className="block">Confirm Google place ID<input required value={placeId} onChange={e => setPlaceId(e.target.value)} className="block w-full rounded-lg border-slate-300" /></label>
        {row.googlePlaceId && <p className="break-all">Saved ID: {row.googlePlaceId} · <a href={'https://search.google.com/local/writereview?placeid=' + encodeURIComponent(row.googlePlaceId)} target="_blank" rel="noreferrer" className="underline">Preview public review destination</a></p>}
        {Object.entries(checks).map(([key,label]) => <label key={key} className="flex items-start gap-2"><input type="checkbox" required checked={proof[key] ?? false} onChange={e => setProof(p => ({...p,[key]:e.target.checked}))} className="mt-1" /><span>{label}</span></label>)}
      </>}
      <label className="block">Operator note (internal)<textarea required minLength={5} maxLength={2000} value={note} onChange={e => setNote(e.target.value)} className="block w-full rounded-lg border-slate-300" placeholder="Record what you checked, or what is blocking setup." /></label>
      <button disabled={busy || (status === 'verified' && (row.locationCount !== 1 || !row.googlePlaceId))} className="rounded-lg bg-slate-800 px-4 py-2 text-white disabled:opacity-50">{busy ? 'Saving…' : 'Save setup record'}</button>
      {message && <p role="status">{message}</p>}
    </form>
  </details>;
}
export default function CampaignSetupQueue() {
  const [page, setPage] = useState(1);
  const { data, error, isLoading, mutate } = useSWR<{ data: { requests: SetupRow[]; total: number; hasMore: boolean } }>(`/admin/campaign-setup?page=${page}`, fetcher);
  return <section className="space-y-4">
    <div className="flex justify-between"><h2 className="font-semibold text-slate-900">Campaign setup requests</h2><button onClick={() => void mutate()} className="text-sm underline">Refresh</button></div>
    <p className="text-sm text-slate-600">Configure the feedback form and campaign in the provider dashboard. Verify the business-specific public review link, equal access for every rating, sender and opt-out settings. A synced campaign below is not proof of delivery or destination accuracy. Multi-location requests need individual destination checks; the provider IDs shown belong to the client account.</p>
    {error && <p role="alert">Could not load setup requests. Please retry.</p>}
    {isLoading && <p>Loading requests…</p>}
    {data?.data.requests.length === 0 && <p>No setup requests.</p>}
    {data?.data.requests.map(r => <article key={r.id} className="rounded-xl border border-slate-200 p-4 space-y-2">
      <h3 className="font-semibold">{r.businessName} — {r.locationName}{r.city ? `, ${r.city}` : ''}</h3>
      <p className="text-sm font-medium">Status: {r.status.replace(/_/g, ' ')}{r.verifiedAt ? ` · Email setup checked ${new Date(r.verifiedAt).toLocaleString()}` : ''}</p>
      <p className="text-sm text-slate-500">Requested {new Date(r.requestedAt).toLocaleString()} · Organization {r.organizationId ?? 'not provisioned'} · Provider location {r.providerLocationId ?? 'not provisioned'}</p>
      <p className="text-sm">{r.campaigns.length ? 'Campaigns synced for this client (verify the requested location):' : 'No campaigns synced for this client yet.'}</p>
      {r.campaigns.map(c => <p key={c.providerId} className="text-sm">{c.name} · {c.providerId} · Last sync: {c.lastSyncAt ? new Date(c.lastSyncAt).toLocaleString() : 'unknown'}</p>)}
      <VerificationForm key={`${r.id}-${r.revision}`} row={r} onSaved={mutate} />
      <details className="text-sm"><summary className="cursor-pointer">Verification history ({r.events.length})</summary>{r.events.length ? r.events.map(e => <div key={e.revision} className="mt-2 border-t border-slate-100 pt-2"><p>Revision {e.revision} · {e.status.replace(/_/g, ' ')} · {new Date(e.createdAt).toLocaleString()}</p><p className="whitespace-pre-wrap break-words">{e.note}</p><p className="text-xs text-slate-500 break-all">{e.verification ? `Verified ${e.verification.templateVersion} · Campaign ${e.verification.campaignId} · Google place ${e.verification.googlePlaceId}` : ''}</p><p className="text-xs text-slate-500 break-all">Operator: {e.actorId ?? 'Deleted operator'}</p></div>) : <p>No operator changes recorded.</p>}</details>
    </article>)}
    <div className="flex gap-4 text-sm"><button disabled={page === 1} onClick={() => setPage(p => p - 1)} className="disabled:opacity-40">Previous</button><span>Page {page} · {data?.data.total ?? '…'} requests</span><button disabled={!data?.data.hasMore} onClick={() => setPage(p => p + 1)} className="disabled:opacity-40">Next</button></div>
  </section>;
}
