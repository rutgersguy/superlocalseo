import { useState } from 'react';
import { Link } from 'react-router-dom';
import useSWR, { mutate } from 'swr';
import { LineChart, Line, ResponsiveContainer } from 'recharts';
import { fetcher, apiFetch } from '../services/api';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Metrics {
  avgRank: number | null;
  keywordsInTop3: number;
  keywordsInTop10: number;
  totalKeywords: number | null;
  totalReviews: number;
  avgRating: number | null;
  newReviewsThisMonth: number;
  citationScore: number | null;
  locationCount: number;
  date: string | null;
}

interface MetricsResponse {
  success: boolean;
  data: Metrics;
}

interface RankingRow {
  keywordId: string;
  keyword: string;
  location: string;
  rank: number;
  delta: number | null;
}

interface RankingsResponse {
  success: boolean;
  data: RankingRow[];
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function Skeleton({ className }: { className?: string }) {
  return <div className={`animate-pulse bg-gray-200 rounded ${className ?? ''}`} />;
}

// ─── Metric card ──────────────────────────────────────────────────────────────

interface MetricCardProps {
  label: string;
  value: string | number;
  loading: boolean;
}

function MetricCard({ label, value, loading }: MetricCardProps) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
      <p className="text-sm text-gray-500 mb-1">{label}</p>
      {loading ? (
        <Skeleton className="h-8 w-20 mt-1" />
      ) : (
        <p className="text-3xl font-bold text-gray-900">{value}</p>
      )}
    </div>
  );
}

// ─── Visibility card ──────────────────────────────────────────────────────────

function VisibilityCard({ vis, loading }: { vis?: { current: number | null; delta: number | null; series: Array<{ date: string; score: number }> }; loading: boolean }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6 col-span-2 lg:col-span-1">
      <p className="text-sm text-gray-500 mb-1">Visibility Score</p>
      {loading ? (
        <div className="animate-pulse bg-gray-200 rounded h-8 w-20 mt-1" />
      ) : vis?.current != null ? (
        <>
          <div className="flex items-end gap-2">
            <p className="text-3xl font-bold text-gray-900">{vis.current}</p>
            <span className="text-sm text-gray-400 mb-1">/ 100</span>
            {vis.delta !== null && (
              <span className={`text-sm font-medium mb-1 ${vis.delta >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                {vis.delta >= 0 ? '▲' : '▼'}{Math.abs(vis.delta)} vs 30d ago
              </span>
            )}
          </div>
          {vis.series.length > 1 && (
            <div className="mt-3 h-12">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={vis.series}>
                  <Line type="monotone" dataKey="score" stroke="#6366f1" dot={false} strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </>
      ) : (
        <p className="text-sm text-gray-400 mt-2">Collecting data…</p>
      )}
    </div>
  );
}

// ─── Delta badge ──────────────────────────────────────────────────────────────

function DeltaBadge({ delta }: { delta: number }) {
  if (delta === 0) return <span className="text-gray-400 text-sm">—</span>;
  const improved = delta < 0; // lower rank number = better
  return (
    <span
      className={`inline-flex items-center gap-0.5 text-sm font-medium ${
        improved ? 'text-green-600' : 'text-red-500'
      }`}
    >
      {improved ? '▲' : '▼'} {Math.abs(delta)}
    </span>
  );
}

interface RoiTotals {
  estClicks: number;
  estLeads: number;
  estRevenue: number;
}

interface RoiResponse {
  success: boolean;
  data: {
    roiConfig: { avgCustomerValue: number; conversionRate: number };
    totals: RoiTotals;
  };
}

function fmt$(n: number) {
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}k`;
  return `$${n.toLocaleString()}`;
}

// ─── Main component ───────────────────────────────────────────────────────────

interface ClientResponse {
  success: boolean;
  data: { emrProvisioningStatus?: string };
}

function EMRProvisionBanner() {
  const { data: clientData, isLoading } = useSWR<ClientResponse>('/clients', fetcher);
  const [retrying, setRetrying] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  const status = clientData?.data?.emrProvisioningStatus;
  if (isLoading || dismissed || status === 'provisioned' || status === 'pending') return null;

  const handleRetry = async () => {
    setRetrying(true);
    try {
      await apiFetch('/clients/retry-emr-provision', { method: 'POST' });
      await mutate('/clients');
    } catch {
      // retry failed — user can try again
    } finally {
      setRetrying(false);
    }
  };

  return (
    <div className="flex items-center justify-between p-4 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
      <span>Your review account setup didn't complete. This may affect review campaigns and widgets.</span>
      <div className="flex items-center gap-3 ml-4 shrink-0">
        <button
          onClick={() => void handleRetry()}
          disabled={retrying}
          className="font-medium underline hover:no-underline disabled:opacity-50"
        >
          {retrying ? 'Retrying…' : 'Retry setup'}
        </button>
        <button onClick={() => setDismissed(true)} className="text-amber-600 hover:text-amber-800 font-bold">
          ×
        </button>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { data: metricsData, isLoading: metricsLoading, error: metricsError } =
    useSWR<MetricsResponse>('/metrics', fetcher);

  const { data: rankingsData, isLoading: rankingsLoading, error: rankingsError } =
    useSWR<RankingsResponse>('/rankings?limit=10', fetcher);

  const { data: roiData } = useSWR<RoiResponse>('/analytics/roi', fetcher);

  const { data: visData } = useSWR<{ success: boolean; data: { current: number | null; delta: number | null; series: Array<{ date: string; score: number }> } }>('/metrics/visibility', fetcher);
  const vis = visData?.data;

  const { data: auditData } = useSWR<{ success: boolean; data: { audits: Array<{ locationId: string; status: string; compositeScore: number | null }> } }>('/audits/bl', fetcher);
  const latestAuditScore = (auditData?.data?.audits ?? []).find((a) => a.status === 'complete')?.compositeScore ?? null;

  const metrics = metricsData?.data;
  const rankings = rankingsData?.data ?? [];
  const roi = roiData?.data;
  const roiConfigured = (roi?.roiConfig?.avgCustomerValue ?? 0) > 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-sm text-gray-500 mt-1">Overview of your local SEO performance</p>
      </div>

      <EMRProvisionBanner />

      {/* Error state */}
      {metricsError && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          Failed to load metrics. Please refresh.
        </div>
      )}

      {/* Metric cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard label="Avg Rank" value={metrics?.avgRank != null ? metrics.avgRank.toFixed(1) : '—'} loading={metricsLoading} />
        <MetricCard label="Keywords in Top 10" value={metrics?.keywordsInTop10 ?? '—'} loading={metricsLoading} />
        <MetricCard label="Total Reviews" value={metrics?.totalReviews ?? '—'} loading={metricsLoading} />
        <MetricCard label="Avg Rating" value={metrics?.avgRating != null ? metrics.avgRating.toFixed(1) : '—'} loading={metricsLoading} />
        <MetricCard label="Local SEO Score" value={latestAuditScore != null ? `${latestAuditScore.toFixed(0)}/100` : '—'} loading={!auditData} />
        <VisibilityCard vis={vis} loading={!visData} />
      </div>

      {/* ROI banner — only shown once avgCustomerValue is configured */}
      {roiConfigured && roi ? (
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: 'Est. Monthly Clicks', value: roi.totals.estClicks.toLocaleString() },
            { label: 'Est. Monthly Leads', value: roi.totals.estLeads.toLocaleString() },
            { label: 'Est. Monthly Revenue', value: fmt$(roi.totals.estRevenue) },
          ].map((card) => (
            <div key={card.label} className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
              <p className="text-xs text-gray-500 mb-1">{card.label}</p>
              <p className="text-2xl font-bold text-gray-900">{card.value}</p>
            </div>
          ))}
        </div>
      ) : (
        <div className="bg-brand-50 border border-brand-100 rounded-xl px-5 py-4 flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-brand-800">Unlock your ROI estimate</p>
            <p className="text-xs text-brand-600 mt-0.5">Enter your average customer value to see the monthly $ impact of your rankings.</p>
          </div>
          <Link to="/dashboard/rankings" className="text-sm font-semibold text-brand-600 hover:text-brand-800 whitespace-nowrap ml-4">Set it up →</Link>
        </div>
      )}

      {/* Keyword summary table */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm">
        <div className="px-6 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">Top Keywords</h2>
          <p className="text-xs text-gray-500 mt-0.5">Showing top 10 keywords by rank</p>
        </div>

        {rankingsError && (
          <div className="p-6 text-sm text-red-600">Failed to load rankings.</div>
        )}

        {rankingsLoading ? (
          <div className="divide-y divide-gray-100">
            {Array.from({ length: 5 }, (_, i) => (
              <div key={i} className="px-6 py-4 flex gap-4">
                <Skeleton className="h-4 flex-1" />
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-12" />
                <Skeleton className="h-4 w-12" />
              </div>
            ))}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Keyword</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Location</th>
                  <th className="px-6 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Rank</th>
                  <th className="px-6 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Change</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {rankings.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-6 py-8 text-center text-gray-400 text-sm">
                      No ranking data yet.
                    </td>
                  </tr>
                ) : (
                  rankings.map((row) => (
                    <tr key={row.keywordId} className="hover:bg-gray-50 transition-colors">
                      <td className="px-6 py-3 font-medium text-gray-900">{row.keyword}</td>
                      <td className="px-6 py-3 text-gray-500">{row.location ?? '—'}</td>
                      <td className="px-6 py-3 text-right font-semibold text-gray-900">{row.rank}</td>
                      <td className="px-6 py-3 text-right">
                        {row.delta != null ? <DeltaBadge delta={row.delta} /> : <span className="text-gray-400">—</span>}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
