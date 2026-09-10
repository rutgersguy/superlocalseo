import { useState } from 'react';
import useSWR from 'swr';
import { apiFetch, fetcher } from '../services/api';

interface MappingRow {
  locationId: string; businessName: string; locationName: string; city: string | null;
  googlePlaceId: string | null; legacyOrganizationId: string | null; legacyProviderLocationId: string | null;
  mapping: null | {
    organizationId: string; providerLocationId: string; googlePlaceId: string; revision: number;
    verifiedAt: string; identityCurrent: boolean;
    events: Array<{ revision: number; note: string; actorId: string | null; createdAt: string }>;
  };
}
function MappingForm({ row, available, onSaved }: { row: MappingRow; available: boolean; onSaved: () => Promise<unknown> }) {
  const [organizationId, setOrganizationId] = useState(row.mapping?.organizationId ?? '');
  const [providerLocationId, setProviderLocationId] = useState(row.mapping?.providerLocationId ?? '');
  const [googlePlaceId, setGooglePlaceId] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  async function save(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setMessage('');
    try {
      const result = await apiFetch<{ success: boolean; error?: { message: string } }>(`/admin/provider-mappings/${row.locationId}`, {
        method: 'PUT', body: JSON.stringify({ revision: row.mapping?.revision ?? 0, organizationId, providerLocationId, googlePlaceId, note }),
      });
      if (!result.success) throw new Error(result.error?.message ?? 'Could not save mapping.');
      await onSaved(); setMessage('Verified mapping saved.');
    } catch (e) { setMessage((e as Error).message); } finally { setBusy(false); }
  }
  return <details className="text-sm"><summary className="cursor-pointer font-medium">Verify a provider mapping</summary>
    <form onSubmit={save} className="mt-3 space-y-3">
      <fieldset disabled={!available || busy || !row.googlePlaceId} className="space-y-3 disabled:opacity-50">
        <label className="block">EMR organization ID<input required pattern="[1-9][0-9]{0,14}" value={organizationId} onChange={e => setOrganizationId(e.target.value)} className="block w-full rounded-lg border-slate-300" /></label>
        <label className="block">EMR location ID<input required pattern="[1-9][0-9]{0,14}" value={providerLocationId} onChange={e => setProviderLocationId(e.target.value)} className="block w-full rounded-lg border-slate-300" /></label>
        <label className="block">Confirm Google Place ID<input required pattern="[A-Za-z0-9_-]{5,255}" value={googlePlaceId} onChange={e => setGooglePlaceId(e.target.value)} className="block w-full rounded-lg border-slate-300" /></label>
        <label className="block">Operator note (internal)<textarea required minLength={5} maxLength={2000} value={note} onChange={e => setNote(e.target.value)} className="block w-full rounded-lg border-slate-300" /></label>
        <button className="rounded-lg bg-slate-800 px-4 py-2 text-white">{busy ? 'Verifying…' : 'Verify and save mapping'}</button>
      </fieldset>
      {!row.googlePlaceId && <p>This location needs a saved Google Place ID before verification.</p>}
      {message && <p role="status">{message}</p>}
    </form>
  </details>;
}
export default function ProviderMappings() {
  const [page, setPage] = useState(1);
  const { data, error, isLoading, mutate } = useSWR<{ data: {
    locations: MappingRow[]; total: number; hasMore: boolean;
    verificationAvailable: boolean; verificationUnavailableReason?: string;
  } }>(`/admin/provider-mappings?page=${page}`, fetcher);
  const result = data?.data;
  return <section className="space-y-4">
    <div className="flex justify-between"><h2 className="font-semibold text-slate-900">Provider location mappings</h2><button onClick={() => void mutate()} className="text-sm underline">Refresh</button></div>
    <p className="text-sm text-slate-600">Match each business location to its EMR organization, EMR location and exact Google Place ID. Account-level IDs below are historical references and have not been verified for each location. Reviews and campaigns still use those account-level IDs until the routing migration is complete.</p>
    {result && !result.verificationAvailable && <p role="status" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{result.verificationUnavailableReason ?? 'Saving mappings is unavailable while provider identity verification is being validated.'}</p>}
    {error && <p role="alert">Could not load provider mappings. Please retry.</p>}
    {isLoading && <p>Loading locations…</p>}
    {result?.locations.length === 0 && <p>No locations.</p>}
    {result?.locations.map(row => <article key={row.locationId} className="space-y-3 rounded-xl border border-slate-200 p-4">
      <h3 className="font-semibold">{row.businessName} — {row.locationName}{row.city ? `, ${row.city}` : ''}</h3>
      <p className="text-sm font-medium">{!row.mapping ? 'Unmapped' : !row.mapping.identityCurrent ? 'Reverification needed: saved Google identity changed' : 'Mapping recorded'}</p>
      <p className="break-all text-sm">Saved Google Place ID: {row.googlePlaceId ?? 'Missing'}</p>
      <p className="text-sm text-slate-500">Historical account IDs: organization {row.legacyOrganizationId ?? 'none'} · location {row.legacyProviderLocationId ?? 'none'}</p>
      {row.mapping && <p className="text-sm">Recorded organization {row.mapping.organizationId} · location {row.mapping.providerLocationId} · Checked {new Date(row.mapping.verifiedAt).toLocaleString()} · Revision {row.mapping.revision}</p>}
      <MappingForm key={`${row.locationId}-${row.mapping?.revision ?? 0}-${row.googlePlaceId}`} row={row} available={result.verificationAvailable === true} onSaved={mutate} />
      {!!row.mapping?.events.length && <details className="text-sm"><summary className="cursor-pointer">Mapping history ({row.mapping.events.length})</summary>{row.mapping.events.map(event => <div key={event.revision} className="mt-2 border-t border-slate-100 pt-2"><p>Revision {event.revision} · {new Date(event.createdAt).toLocaleString()}</p><p className="whitespace-pre-wrap break-words">{event.note}</p><p className="break-all text-xs text-slate-500">Operator: {event.actorId ?? 'Deleted operator'}</p></div>)}</details>}
    </article>)}
    <div className="flex gap-4 text-sm"><button disabled={page === 1} onClick={() => setPage(p => p - 1)} className="disabled:opacity-40">Previous</button><span>Page {page} · {result?.total ?? '…'} locations</span><button disabled={!result?.hasMore} onClick={() => setPage(p => p + 1)} className="disabled:opacity-40">Next</button></div>
  </section>;
}
