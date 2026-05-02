import { useState } from 'react';
import useSWR, { mutate } from 'swr';
import { LineChart, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { fetcher, apiFetch } from '../services/api';

interface LocationOption { id: string; name: string; blCampaignId?: string | null; }
interface LocationsResponse { success: boolean; data: LocationOption[]; }

interface AuditRow {
  id: string;
  locationId: string;
  status: string;
  napScore: number | null;
  citationScore: number | null;
  reviewScore: number | null;
  googleScore: number | null;
  compositeScore: number | null;
  recommendations: string[];
  completedAt: string | null;
  createdAt: string;
}
interface AuditsResponse { success: boolean; data: { audits: AuditRow[] }; }
interface HistoryResponse { success: boolean; data: { audits: AuditRow[] }; }

function ScoreCard({ label, value }: { label: string; value: number | null }) {
  const color = value == null ? 'text-gray-400'
    : value >= 80 ? 'text-green-600'
    : value >= 60 ? 'text-yellow-600'
    : 'text-red-500';
  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 text-center">
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <p className={`text-2xl font-bold ${color}`}>{value != null ? value.toFixed(0) : '—'}</p>
      <p className="text-xs text-gray-400">/ 100</p>
    </div>
  );
}

export default function AuditHistory() {
  const [selectedLocationId, setSelectedLocationId] = useState('');
  const [triggering, setTriggering] = useState(false);
  const [triggerError, setTriggerError] = useState<string | null>(null);

  const { data: locData } = useSWR<LocationsResponse>('/locations', fetcher);
  const locations = locData?.data ?? [];

  const { data: auditsData, isLoading } = useSWR<AuditsResponse>('/audits/bl', fetcher);
  const allAudits = auditsData?.data?.audits ?? [];

  const effectiveLocationId = selectedLocationId || locations[0]?.id || '';

  const { data: historyData } = useSWR<HistoryResponse>(
    effectiveLocationId ? `/audits/bl/location/${effectiveLocationId}/history` : null,
    fetcher,
  );
  const historyAudits = historyData?.data?.audits ?? [];

  const latestAudit = allAudits.find((a) => a.locationId === effectiveLocationId && a.status === 'complete');
  const selectedLocation = locations.find((l) => l.id === effectiveLocationId);
  const hasBLCampaign = !!selectedLocation?.blCampaignId;

  const recentAuditDaysAgo = (() => {
    const recent = allAudits.find((a) => a.locationId === effectiveLocationId);
    if (!recent) return null;
    return Math.floor((Date.now() - new Date(recent.createdAt).getTime()) / (1000 * 60 * 60 * 24));
  })();

  const canTrigger = hasBLCampaign && (recentAuditDaysAgo === null || recentAuditDaysAgo >= 30);
  const cooldownDaysLeft = recentAuditDaysAgo !== null && recentAuditDaysAgo < 30 ? 30 - recentAuditDaysAgo : null;

  const chartData = historyAudits
    .filter((a) => a.status === 'complete')
    .map((a) => ({
      date: a.completedAt ? new Date(a.completedAt).toLocaleDateString('en-US', { month: 'short', year: '2-digit' }) : '',
      NAP: a.napScore,
      Citations: a.citationScore,
      Reviews: a.reviewScore,
      Google: a.googleScore,
      Overall: a.compositeScore,
    }));

  const handleTrigger = async () => {
    if (!effectiveLocationId) return;
    setTriggering(true);
    setTriggerError(null);
    try {
      await apiFetch('/audits/bl/generate', {
        method: 'POST',
        body: JSON.stringify({ locationId: effectiveLocationId }),
      });
      await mutate('/audits/bl');
    } catch (e) {
      setTriggerError((e as Error).message ?? 'Failed to trigger audit');
    } finally {
      setTriggering(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Local SEO Audit</h1>
          <p className="text-sm text-gray-500 mt-1">Monthly health scores across NAP, citations, reviews, and Google presence</p>
        </div>
        <div className="flex items-center gap-3">
          {locations.length > 1 && (
            <select value={effectiveLocationId} onChange={(e) => setSelectedLocationId(e.target.value)}
              className="text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500">
              {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          )}
          <button
            onClick={() => void handleTrigger()}
            disabled={triggering || !canTrigger}
            title={!hasBLCampaign ? 'No campaign configured for this location' : cooldownDaysLeft ? `Next audit in ${cooldownDaysLeft} days` : ''}
            className="px-4 py-2 text-sm font-medium bg-brand-600 text-white rounded-lg hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {triggering ? 'Starting…' : 'Run Audit Now'}
          </button>
        </div>
      </div>

      {triggerError && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{triggerError}</div>
      )}

      {!hasBLCampaign && selectedLocation && (
        <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
          This location doesn't have a campaign configured yet. Connect your integrations to enable audits.
        </div>
      )}

      {/* Score cards */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
        <ScoreCard label="Overall" value={latestAudit?.compositeScore ?? null} />
        <ScoreCard label="NAP" value={latestAudit?.napScore ?? null} />
        <ScoreCard label="Citations" value={latestAudit?.citationScore ?? null} />
        <ScoreCard label="Reviews" value={latestAudit?.reviewScore ?? null} />
        <ScoreCard label="Google" value={latestAudit?.googleScore ?? null} />
      </div>

      {/* History chart */}
      {chartData.length > 1 && (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
          <h2 className="text-base font-semibold text-gray-900 mb-4">Score History</h2>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="Overall" stroke="#6366f1" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="NAP" stroke="#10b981" strokeWidth={1.5} dot={false} />
                <Line type="monotone" dataKey="Citations" stroke="#f59e0b" strokeWidth={1.5} dot={false} />
                <Line type="monotone" dataKey="Reviews" stroke="#3b82f6" strokeWidth={1.5} dot={false} />
                <Line type="monotone" dataKey="Google" stroke="#ef4444" strokeWidth={1.5} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Recommendations */}
      {latestAudit && latestAudit.recommendations && latestAudit.recommendations.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
          <h2 className="text-base font-semibold text-gray-900 mb-3">Recommendations</h2>
          <ul className="space-y-2">
            {latestAudit.recommendations.map((rec, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
                <span className="mt-0.5 text-amber-500 flex-shrink-0">●</span>
                {rec}
              </li>
            ))}
          </ul>
        </div>
      )}

      {!isLoading && allAudits.length === 0 && (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-12 text-center">
          <p className="text-gray-400 text-sm">No audit data yet. Run your first audit to see your Local SEO score.</p>
        </div>
      )}
    </div>
  );
}
