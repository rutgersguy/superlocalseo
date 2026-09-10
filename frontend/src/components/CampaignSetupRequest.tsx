import { useState } from 'react';
import useSWR from 'swr';
import { Link } from 'react-router-dom';
import { apiFetch, fetcher } from '../services/api';

export default function CampaignSetupRequest() {
  const { data, error, isLoading, mutate } = useSWR<{ data: { locations: Array<{ id: string; name: string; city: string | null }>; requests: Array<{ locationId: string; requestedAt: string; status: string; verifiedAt: string | null; campaignName: string | null }> } }>('/campaigns/setup', fetcher, { refreshInterval: 30000 });
  const [locationId, setLocationId] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const locations = data?.data.locations ?? [];
  const selected = locationId || (locations.length === 1 ? locations[0].id : '');
  const existing = data?.data.requests.find(r => r.locationId === selected);
  async function submit() {
    if (busy || !selected) return;
    setBusy(true); setMessage('');
    try {
      const result = await apiFetch<{ success: boolean; error?: { message: string } }>('/campaigns/setup', { method: 'POST', body: JSON.stringify({ locationId: selected }) });
      if (!result.success) throw new Error(result.error?.message || 'Could not request setup');
      setMessage('Setup requested. Our team will configure the campaign for this location.');
      await mutate();
    } catch(e) { setMessage((e as Error).message); } finally { setBusy(false); }
  }
  if (isLoading) return <p>Loading your locations…</p>;
  if (error) return <p role="alert">Could not load setup status. <button onClick={() => void mutate()} className="underline">Retry</button></p>;
  return <div className="space-y-3">
    <p>Request setup here and our team will configure the campaign for the correct business. No separate review-platform login is needed.</p>
    {locations.length ? <><label className="block">Business location<select aria-label="Business location" value={selected} onChange={e => { setLocationId(e.target.value); setMessage(''); }} className="mt-1 block w-full rounded-lg border-slate-300"><option value="">Select a location</option>{locations.map(l => <option key={l.id} value={l.id}>{l.name}{l.city ? ` — ${l.city}` : ''}</option>)}</select></label>
    {existing ? <p role="status">Setup requested on {new Date(existing.requestedAt).toLocaleDateString()}. {existing.status === 'verified' ? `Email campaign setup checked${existing.verifiedAt ? ' on ' + new Date(existing.verifiedAt).toLocaleDateString() : ''}: ${existing.campaignName ?? ''}. This confirms configuration, not delivery.` : existing.status === 'blocked' ? 'Setup needs attention from our team. No verified campaign is recorded yet.' : existing.status === 'in_progress' ? 'Our team is configuring and checking your campaign.' : existing.status === 'needs_reverification' ? 'Business or campaign details changed. Our team must recheck setup.' : 'Your request is saved and is awaiting configuration and verification.'}</p> : <button disabled={busy || !selected} onClick={() => void submit()} className="rounded-lg bg-brand-500 px-4 py-2 text-white disabled:opacity-50">{busy ? 'Saving…' : 'Request campaign setup'}</button>}</> : <Link to="/dashboard/settings" className="underline">Add a business location in Settings first.</Link>}
    {message && <p role="status">{message}</p>}
    <p className="text-xs text-slate-500">Requesting setup does not send any invitations.</p>
  </div>;
}
