import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
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
  return <div className={`animate-pulse bg-slate-100 rounded ${className ?? ''}`} />;
}

// ─── Metric card ──────────────────────────────────────────────────────────────

interface MetricCardProps {
  label: string;
  value: string | number;
  loading: boolean;
  accent?: string;
  sub?: string;
}

function MetricCard({ label, value, loading, accent, sub }: MetricCardProps) {
  return (
    <div className="bg-white rounded-xl shadow-card p-5 flex flex-col gap-3">
      <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">{label}</p>
      {loading ? (
        <Skeleton className="h-9 w-24" />
      ) : (
        <div>
          <p className={`text-3xl font-bold tracking-tight ${accent ?? 'text-slate-900'}`}>{value}</p>
          {sub && <p className="text-xs text-slate-400 mt-1">{sub}</p>}
        </div>
      )}
    </div>
  );
}

// ─── Visibility card ──────────────────────────────────────────────────────────

function VisibilityCard({ vis, loading }: { vis?: { current: number | null; delta: number | null; series: Array<{ date: string; score: number }> }; loading: boolean }) {
  return (
    <div className="bg-white rounded-xl shadow-card p-5 col-span-2 lg:col-span-1 flex flex-col gap-3">
      <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">Visibility Score</p>
      {loading ? (
        <Skeleton className="h-9 w-24" />
      ) : vis?.current != null ? (
        <>
          <div className="flex items-end gap-2">
            <p className="text-3xl font-bold tracking-tight text-slate-900">{vis.current}</p>
            <span className="text-sm text-slate-400 mb-0.5">/ 100</span>
            {vis.delta !== null && (
              <span className={`text-sm font-semibold mb-0.5 ${vis.delta >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                {vis.delta >= 0 ? '▲' : '▼'} {Math.abs(vis.delta)}
              </span>
            )}
          </div>
          {vis.series.length > 1 && (
            <div className="h-10 -mx-1">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={vis.series}>
                  <Line type="monotone" dataKey="score" stroke="#2563eb" dot={false} strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </>
      ) : (
        <p className="text-sm text-slate-400">Collecting data…</p>
      )}
    </div>
  );
}

// ─── Delta badge ──────────────────────────────────────────────────────────────

function DeltaBadge({ delta }: { delta: number }) {
  if (delta === 0) return <span className="text-slate-300 text-sm">—</span>;
  const improved = delta < 0; // lower rank = better
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-semibold ${improved ? 'text-emerald-600' : 'text-red-500'}`}>
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

interface BillingStatusResponse {
  success: boolean;
  data: { status: string | null; graceDaysRemaining: number | null; trialDaysRemaining: number | null };
}

function TrialBanner() {
  const { data } = useSWR<BillingStatusResponse>('/billing', fetcher);
  const billing = data?.data;
  if (!billing || billing.status !== 'trialing') return null;

  const days = billing.trialDaysRemaining;
  const expired = days !== null && days <= 0;
  const urgent = days !== null && days <= 3 && !expired;

  if (days === null || days > 5) return null;

  return (
    <div className={`flex items-center justify-between p-4 rounded-lg text-sm border ${
      expired
        ? 'bg-red-50 border-red-200 text-red-800'
        : urgent
        ? 'bg-amber-50 border-amber-200 text-amber-800'
        : 'bg-blue-50 border-blue-200 text-blue-800'
    }`}>
      <span>
        {expired
          ? <><strong>Your free trial has ended.</strong> Subscribe to keep access to your data.</>
          : <><strong>{days} day{days !== 1 ? 's' : ''} left in your trial.</strong> Subscribe to keep your rankings, reviews, and citation data after the trial.</>}
      </span>
      <a
        href="/dashboard/settings?tab=billing"
        className="ml-4 shrink-0 font-semibold underline hover:no-underline"
      >
        {expired ? 'Subscribe now' : 'Choose a plan'}
      </a>
    </div>
  );
}

function PastDueBanner() {
  const { data } = useSWR<BillingStatusResponse>('/billing', fetcher);
  const billing = data?.data;
  if (!billing || billing.status !== 'past_due') return null;
  const days = billing.graceDaysRemaining;
  return (
    <div className="flex items-center justify-between p-4 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
      <span>
        <strong>Payment overdue.</strong>{' '}
        {days != null && days > 0
          ? `Access will be restricted in ${days} day${days !== 1 ? 's' : ''} if payment isn't resolved.`
          : 'Please update your payment method to avoid losing access.'}
      </span>
      <a href="/dashboard/settings?tab=billing" className="ml-4 shrink-0 font-medium underline hover:no-underline">
        Update payment
      </a>
    </div>
  );
}

function EMRProvisionBanner() {
  const { data: clientData, isLoading } = useSWR<ClientResponse>('/clients', fetcher);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  const status = clientData?.data?.emrProvisioningStatus;
  if (isLoading || dismissed || status === 'provisioned' || status === 'pending') return null;

  const handleRetry = async () => {
    setRetrying(true);
    setRetryError(false);
    try {
      await apiFetch('/clients/retry-emr-provision', { method: 'POST' });
      await mutate('/clients');
    } catch {
      setRetryError(true);
    } finally {
      setRetrying(false);
    }
  };

  return (
    <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800 space-y-1">
      <div className="flex items-center justify-between">
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
      {retryError && (
        <p className="text-xs text-red-700">Setup failed — please try again or contact support if the problem persists.</p>
      )}
    </div>
  );
}

export default function Dashboard() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [linkedDismissed, setLinkedDismissed] = useState(false);
  const showLinkedBanner = searchParams.get('linked') === '1' && !linkedDismissed;

  const dismissLinked = () => {
    setLinkedDismissed(true);
    setSearchParams((p) => { p.delete('linked'); return p; }, { replace: true });
  };

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
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-slate-900 tracking-tight">Dashboard</h1>
        <p className="text-sm text-slate-500 mt-0.5">Overview of your local SEO performance</p>
      </div>

      {showLinkedBanner && (
        <div className="flex items-center justify-between p-4 bg-emerald-50 border border-emerald-200 rounded-xl text-sm text-emerald-800">
          <span>Your Google account has been linked to your existing account.</span>
          <button onClick={dismissLinked} className="ml-4 text-emerald-600 hover:text-emerald-800 font-medium">Dismiss</button>
        </div>
      )}
      <EMRProvisionBanner />
      <TrialBanner />
      <PastDueBanner />

      {metricsError && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          Failed to load metrics. Please refresh.
        </div>
      )}

      {/* Primary metric row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <MetricCard label="Avg Rank" value={metrics?.avgRank != null ? metrics.avgRank.toFixed(1) : '—'} loading={metricsLoading} sub="across all keywords" />
        <MetricCard label="Keywords in Top 10" value={metrics?.keywordsInTop10 ?? '—'} loading={metricsLoading} sub={metrics ? `of ${metrics.totalKeywords ?? '—'} tracked` : undefined} />
        <MetricCard label="Total Reviews" value={metrics?.totalReviews ?? '—'} loading={metricsLoading} sub={metrics?.newReviewsThisMonth ? `+${metrics.newReviewsThisMonth} this month` : undefined} />
        <MetricCard label="Avg Rating" value={metrics?.avgRating != null ? metrics.avgRating.toFixed(1) : '—'} loading={metricsLoading} accent={metrics?.avgRating != null && metrics.avgRating >= 4 ? 'text-emerald-600' : undefined} />
      </div>

      {/* Secondary metric row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <MetricCard label="Local SEO Score" value={latestAuditScore != null ? `${latestAuditScore.toFixed(0)}/100` : '—'} loading={!auditData} />
        <VisibilityCard vis={vis} loading={!visData} />
      </div>

      {/* ROI section */}
      {roiConfigured && roi ? (
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: 'Est. Monthly Clicks', value: roi.totals.estClicks.toLocaleString(), accent: undefined },
            { label: 'Est. Monthly Leads',  value: roi.totals.estLeads.toLocaleString(),  accent: undefined },
            { label: 'Est. Monthly Revenue', value: fmt$(roi.totals.estRevenue), accent: 'text-emerald-600' as const },
          ].map((card) => (
            <div key={card.label} className="bg-white rounded-xl shadow-card p-5">
              <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-3">{card.label}</p>
              <p className={`text-3xl font-bold tracking-tight ${card.accent ?? 'text-slate-900'}`}>{card.value}</p>
            </div>
          ))}
        </div>
      ) : (
        <div className="bg-brand-50 border border-brand-100 rounded-xl px-5 py-4 flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-brand-900">Unlock your ROI estimate</p>
            <p className="text-xs text-brand-600 mt-0.5">Enter your average customer value to see the monthly $ impact of your rankings.</p>
          </div>
          <Link to="/dashboard/rankings?roi=1" className="shrink-0 ml-4 text-sm font-semibold text-brand-600 hover:text-brand-800 transition-colors">Set it up →</Link>
        </div>
      )}

      {/* Top keywords table */}
      <div className="bg-white rounded-xl shadow-card overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Top Keywords</h2>
            <p className="text-xs text-slate-400 mt-0.5">Top 10 by current rank</p>
          </div>
          <Link to="/dashboard/rankings" className="text-xs font-medium text-brand-600 hover:text-brand-700 transition-colors">
            View all →
          </Link>
        </div>

        {rankingsError && (
          <div className="p-6 text-sm text-red-600">Failed to load rankings.</div>
        )}

        {rankingsLoading ? (
          <div className="divide-y divide-slate-50">
            {Array.from({ length: 5 }, (_, i) => (
              <div key={i} className="px-6 py-3.5 flex gap-4">
                <Skeleton className="h-4 flex-1" />
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-4 w-10" />
                <Skeleton className="h-4 w-10" />
              </div>
            ))}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50/70 border-b border-slate-100">
                  <th className="px-6 py-2.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-widest">Keyword</th>
                  <th className="px-6 py-2.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-widest">Location</th>
                  <th className="px-6 py-2.5 text-right text-xs font-semibold text-slate-500 uppercase tracking-widest">Rank</th>
                  <th className="px-6 py-2.5 text-right text-xs font-semibold text-slate-500 uppercase tracking-widest">Change</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {rankings.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-6 py-10 text-center text-slate-400 text-sm">
                      No ranking data yet. Add keywords in Settings to get started.
                    </td>
                  </tr>
                ) : (
                  rankings.map((row) => (
                    <tr key={row.keywordId} className="hover:bg-slate-50/80 transition-colors">
                      <td className="px-6 py-3 font-medium text-slate-800">{row.keyword}</td>
                      <td className="px-6 py-3 text-slate-400 text-xs">{row.location ?? '—'}</td>
                      <td className="px-6 py-3 text-right font-bold text-slate-900">{row.rank}</td>
                      <td className="px-6 py-3 text-right">
                        {row.delta != null ? <DeltaBadge delta={row.delta} /> : <span className="text-slate-300">—</span>}
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
