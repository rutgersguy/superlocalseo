import { useEffect, useRef, useState } from 'react';
import useSWR from 'swr';
import { apiFetch, fetcher } from '../services/api';

interface ConnectionState {
  phase: string;
  profileSelected: boolean;
  selectedAt?: string | null;
  connectUrl: string | null;
  expiresAt?: string | null;
  reviewCount: number | null;
  lastSyncAt: string | null;
  syncError?: string | null;
}
const descriptions: Record<string, [string, string]> = {
  needs_setup: ['Ready to connect', 'Connect the Google account that manages your business, then select the correct business profile.'],
  not_started: ['Not connected yet', 'Connect Google to begin importing reviews.'],
  awaiting_authorization: ['Waiting for Google authorization', 'Finish signing in with Google and keep the Business Profile permission enabled.'],
  select_business: ['Select your business', 'Google sign-in is complete. Continue in the connection tab and select the business you want to manage.'],
  profile_selected: ['Business profile selected', 'Your business selection is recorded. Review import status is shown below; selection alone does not confirm current access to Google.'],
  expired: ['Connection link expired', 'Start again to get a new connection link.'],
  revoked: ['Connection link no longer active', 'Start again to get a usable connection link.'],
  needs_attention: ['Setup needs a check', 'Contact hello@superlocalseo.com so we can check an incomplete setup before creating another review account.'],
};
export default function GoogleReviewConnection() {
  const { data, error: statusError, isLoading, mutate } = useSWR<{ data: ConnectionState }>('/integrations/emr/google/connect-link', fetcher, { dedupingInterval: 30000, shouldRetryOnError: false });
  const [working, setWorking] = useState(false);
  const [waitingSince, setWaitingSince] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [readyUrl, setReadyUrl] = useState<string | null>(null);
  const state = data?.data;
  const [syncMessage, setSyncMessage] = useState('');
  const [syncing, setSyncing] = useState(false);
  const autoImport = useRef<string | null>(null);
  async function importReviews() {
    setSyncing(true); setSyncMessage('');
    try {
      const result = await apiFetch<{ success: boolean; error?: { message: string } }>('/integrations/emr/google/sync', { method: 'POST' });
      setSyncMessage(result.success ? 'Import requested. Check status shortly to see the result.' : result.error?.message || 'Could not request an import.');
    } catch(e) { setSyncMessage((e as Error).message); } finally { setSyncing(false); }
  }
  useEffect(() => {
    const selected = state?.selectedAt;
    if (!statusError && state?.phase === 'profile_selected' && selected && autoImport.current !== selected && (!state.lastSyncAt || new Date(state.lastSyncAt) < new Date(selected))) {
      autoImport.current = selected;
      void importReviews();
    }
  }, [state?.phase, state?.selectedAt, state?.lastSyncAt, statusError]);
  useEffect(() => {
    if (!waitingSince) return;
    if (state?.phase === 'profile_selected' && !statusError) { setWaitingSince(null); return; }
    const timer = setInterval(() => {
      if (Date.now() - waitingSince >= 10 * 60000) { setWaitingSince(null); return; }
      void mutate();
    }, 30000);
    return () => clearInterval(timer);
  }, [waitingSince, state?.phase, statusError, mutate]);
  async function connect() {
    if (working) return;
    // Open synchronously during the click, before the API await, to avoid popup blocking.
    const popup = window.open('about:blank', '_blank');
    if (popup) popup.opener = null;
    setWorking(true); setError(''); setReadyUrl(null);
    try {
      const result = await apiFetch<{ success: boolean; data?: { connectUrl: string }; error?: { message: string } }>('/integrations/emr/google/connect-link', { method: 'POST' });
      if (!result.success || !result.data?.connectUrl) throw new Error(result.error?.message || 'Could not prepare your connection. Please retry.');
      setReadyUrl(result.data.connectUrl);
      if (popup && !popup.closed) popup.location.replace(result.data.connectUrl);
      await mutate().catch(() => undefined);
      setWaitingSince(Date.now());
    } catch (e) { if (popup && !popup.closed) popup.close(); setError((e as Error).message); }
    finally { setWorking(false); }
  }
  const [title, description] = descriptions[state?.phase ?? ''] ?? ['Check your connection', 'Check status or connect Google to continue.'];
  const link = readyUrl ?? state?.connectUrl;
  return <section aria-label="Google review connection" className="rounded-xl border border-slate-200 bg-white p-5 space-y-3">
    <h3 className="font-semibold text-slate-900">Google review connection</h3>
    <p className="text-sm font-medium text-slate-800" role="status">{isLoading ? 'Checking connection…' : statusError ? 'Unable to check connection status' : title}</p>
    <p className="text-sm text-slate-600">{statusError ? 'Your existing data is retained. Retry the status check or reconnect if access needs renewing.' : description}</p>
    {state?.reviewCount !== null && state?.reviewCount !== undefined && <p className="text-sm text-slate-600">{state.reviewCount} Google review{state.reviewCount === 1 ? '' : 's'} imported through this connection.</p>}
    {state?.lastSyncAt ? <p className="text-xs text-slate-500">Last successful import: {new Date(state.lastSyncAt).toLocaleString()}</p> : <p className="text-xs text-slate-500">No successful import recorded yet. An empty business profile may have no reviews.</p>}
    {state?.syncError && <p role="alert" className="text-sm text-amber-800">{state.syncError}</p>}
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    <div className="flex flex-wrap items-center gap-4">
      <button type="button" disabled={working || state?.phase === 'needs_attention'} onClick={() => void connect()} className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{working ? 'Preparing connection…' : state?.profileSelected ? 'Reconnect Google' : 'Connect Google'}</button>
      {state?.profileSelected && <button type="button" disabled={syncing} onClick={() => void importReviews()} className="text-sm text-slate-700 underline">{syncing ? 'Requesting import…' : 'Refresh reviews'}</button>}
      <button type="button" disabled={isLoading || working} onClick={() => void mutate()} className="text-sm text-slate-700 underline">Check status</button>
    </div>
    {syncMessage && <p role="status" className="text-sm text-slate-600">{syncMessage}</p>}
    {link && <p className="text-sm"><a href={link} target="_blank" rel="noopener noreferrer" className="text-brand-700 underline">Continue Google connection</a><span className="text-slate-500"> — use this link if the new tab did not open.</span></p>}
    {waitingSince && <p className="text-xs text-slate-500">Finish the steps in the connection tab, then return here. We check progress every 30 seconds for up to 10 minutes.</p>}
    <p className="text-xs text-slate-500">Use the Google account that manages the intended business. No separate review-platform login is required.</p>
  </section>;
}
