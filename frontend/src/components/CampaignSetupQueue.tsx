import { useState } from 'react';
import useSWR from 'swr';
import { fetcher } from '../services/api';
interface SetupRow { id: string; requestedAt: string; businessName: string; locationName: string; city: string | null; organizationId: number | null; providerLocationId: number | null; campaigns: Array<{ name: string; providerId: string; lastSyncAt: string | null }> }
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
      <p className="text-sm text-slate-500">Requested {new Date(r.requestedAt).toLocaleString()} · Organization {r.organizationId ?? 'not provisioned'} · Provider location {r.providerLocationId ?? 'not provisioned'}</p>
      <p className="text-sm">{r.campaigns.length ? 'Campaigns synced for this client (verify the requested location):' : 'No campaigns synced for this client yet.'}</p>
      {r.campaigns.map(c => <p key={c.providerId} className="text-sm">{c.name} · {c.providerId} · Last sync: {c.lastSyncAt ? new Date(c.lastSyncAt).toLocaleString() : 'unknown'}</p>)}
    </article>)}
    <div className="flex gap-4 text-sm"><button disabled={page === 1} onClick={() => setPage(p => p - 1)} className="disabled:opacity-40">Previous</button><span>Page {page} · {data?.data.total ?? '…'} requests</span><button disabled={!data?.data.hasMore} onClick={() => setPage(p => p + 1)} className="disabled:opacity-40">Next</button></div>
  </section>;
}
