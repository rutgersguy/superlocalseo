import { useEffect, useRef } from 'react';
import useSWR, { useSWRConfig } from 'swr';
import { fetcher } from '../services/api';
import { useAuth } from '../hooks/useAuth';
type Scan = { locationId: string; locationName: string; step: string; status: string; reason: string | null; updatedAt: string };
const names: Record<string, string> = { rankings: 'Rankings and competitors', citations: 'Citations', ai: 'AI visibility', reviews: 'Reviews', map: 'Map sample', audit: 'Website audit' };
export function InitialScanProgress() {
  const { role } = useAuth();
  const { mutate } = useSWRConfig();
  const { data } = useSWR<{ data: Scan[] }>(role === 'client' ? '/locations/initial-scans' : null, fetcher, { refreshInterval: 15000 });
  const scans = data?.data ?? [];
  const previous = useRef('');
  const signature = JSON.stringify(scans);
  const active = scans.some(s => s.status === 'running' || (s.status === 'waiting' && !s.reason));
  useEffect(() => {
    if (!signature || signature === '[]') return;
    if (previous.current !== signature || active) {
      previous.current = signature;
      void mutate(key => typeof key === 'string' && /^\/(metrics|rankings|keywords|citations|ai-visibility|reviews|audits|geo-grid|analytics|competitors)(\?|\/|$)/.test(key));
    }
  }, [signature, active, data, mutate]);
  if (!scans.length || scans.every(s => ['complete', 'existing'].includes(s.status))) return null;
  return <div className="mx-4 mt-4 rounded-xl border border-brand-200 bg-brand-50 p-4 text-sm text-slate-700" role="status">
    <p className="font-semibold">{active ? 'Your first scans are running automatically.' : 'First scan status'}</p>
    <p>Results appear as each check finishes. You do not need to click Refresh. Missing connections or business details are shown below.</p>
    <details className="mt-2"><summary className="cursor-pointer">View checks and next steps</summary>
      <ul className="mt-2 space-y-1">{scans.map(s => <li key={`${s.locationId}-${s.step}`}><strong>{s.locationName} · {names[s.step] ?? s.step}:</strong> {s.reason ?? s.status.replace('_', ' ')}</li>)}</ul>
    </details>
  </div>;
}
