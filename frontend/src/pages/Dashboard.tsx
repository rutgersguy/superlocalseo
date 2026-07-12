import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import useSWR, { mutate } from 'swr';
import { LineChart, Line, ResponsiveContainer } from 'recharts';
import { TrendingUp, Star, ClipboardList, FileText } from 'lucide-react';
import { fetcher, apiFetch } from '../services/api';
import { useClient } from '../hooks/useClient';
import { useAuth } from '../hooks/useAuth';

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
  data: { emrProvisioningStatus?: string; onboardingStep?: number };
}

interface IntegrationsResponse {
  success: boolean;
  data: Array<{ provider: string; status: string }>;
}

interface BillingStatusResponse {
  success: boolean;
  data: { status: string; trialDaysLeft: number | null; trialEndsAt: string | null; locationsLimit: number; locationCount: number };
}

function PastDueBanner({ billing }: { billing: BillingStatusResponse['data'] | undefined }) {
  const [loading, setLoading] = useState(false);
  if (!billing || billing.status !== 'past_due') return null;
  const openPortal = async () => {
    setLoading(true);
    try {
      const res = await apiFetch<{ success: boolean; data: { url: string } }>('/billing/portal', { method: 'POST' });
      if (res.success && res.data?.url) window.location.href = res.data.url;
    } finally { setLoading(false); }
  };
  return (
    <div className="flex items-center justify-between p-4 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
      <span><strong>Payment overdue.</strong> Update your payment method to keep access.</span>
      <button onClick={() => void openPortal()} disabled={loading}
        className="ml-4 shrink-0 font-medium underline hover:no-underline disabled:opacity-50">
        {loading ? 'Redirecting…' : 'Update payment'}
      </button>
    </div>
  );
}

function SubscribeCTA({ billing }: { billing: BillingStatusResponse['data'] | undefined }) {
  if (!billing || (billing.status !== 'trialing' && billing.status !== 'canceled')) return null;

  const days = billing.trialDaysLeft;
  const expired = billing.status === 'canceled' || (days !== null && days <= 0);
  const urgent = !expired && days !== null && days <= 3;

  return (
    <div
      className="relative overflow-hidden rounded-2xl text-white p-6 sm:p-8"
      style={{ background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 60%, #0f172a 100%)' }}
    >
      {/* Glow accents */}
      <div className="absolute -top-10 -right-10 w-56 h-56 rounded-full pointer-events-none" style={{ background: 'radial-gradient(circle, rgba(99,102,241,0.25) 0%, transparent 70%)' }} />
      <div className="absolute -bottom-14 -left-6 w-48 h-48 rounded-full pointer-events-none" style={{ background: 'radial-gradient(circle, rgba(99,102,241,0.12) 0%, transparent 70%)' }} />

      <div className="relative flex flex-col sm:flex-row sm:items-start gap-6">
        {/* Copy */}
        <div className="flex-1 space-y-4">
          {expired ? (
            <>
              <div className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full" style={{ background: 'rgba(239,68,68,0.2)', border: '1px solid rgba(239,68,68,0.35)', color: '#fca5a5' }}>
                <span className="w-1.5 h-1.5 rounded-full bg-red-400 inline-block" />
                Trial ended
              </div>
              <h2 className="text-xl sm:text-2xl font-bold leading-snug text-white">
                Your data is waiting.<br className="hidden sm:block" /> Pick up where you left off.
              </h2>
              <p className="text-sm leading-relaxed" style={{ color: '#cbd5e1' }}>
                All your rankings, reviews, and citation data are saved. Subscribe to reactivate access in seconds.
              </p>
            </>
          ) : (
            <>
              <div
                className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full"
                style={urgent
                  ? { background: 'rgba(245,158,11,0.2)', border: '1px solid rgba(245,158,11,0.35)', color: '#fcd34d' }
                  : { background: 'rgba(99,102,241,0.25)', border: '1px solid rgba(99,102,241,0.4)', color: '#a5b4fc' }}
              >
                <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ background: urgent ? '#fbbf24' : '#818cf8' }} />
                {days === 1 ? '1 day left in trial' : `${days ?? '7'} days left in trial`}
              </div>
              <h2 className="text-xl sm:text-2xl font-bold leading-snug text-white">
                Turn your trial into results.<br className="hidden sm:block" /> Subscribe today.
              </h2>
              <p className="text-sm leading-relaxed" style={{ color: '#cbd5e1' }}>
                Lock in your rankings tracker and review monitoring — all in one platform built to get you found locally. Pick Lite or Pro at checkout.
              </p>
            </>
          )}

          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm" style={{ color: '#94a3b8' }}>
            {['Daily Rank Tracking', 'Review Monitoring + AI Replies', 'Review Request Campaigns', 'Automated Monthly Reports'].map((f) => (
              <li key={f} className="flex items-center gap-2">
                <span className="w-4 h-4 rounded-full flex items-center justify-center shrink-0 text-xs font-bold" style={{ background: 'rgba(99,102,241,0.3)', color: '#a5b4fc' }}>✓</span>
                {f}
              </li>
            ))}
          </ul>
        </div>

        {/* Pricing + CTA */}
        <div className="sm:text-right space-y-4 shrink-0 sm:min-w-[180px]">
          <div>
            <p className="text-xs" style={{ color: '#94a3b8' }}>from</p>
            <div className="flex items-baseline gap-1 sm:justify-end">
              <span className="text-4xl font-bold text-white">$99</span>
              <span className="text-sm" style={{ color: '#94a3b8' }}>/mo</span>
            </div>
            <p className="text-xs mt-0.5" style={{ color: '#64748b' }}>No setup fee · cancel anytime</p>
          </div>
          <a
            href="/billing"
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl font-semibold text-sm transition-all"
            style={{ background: '#6366f1', color: '#fff', boxShadow: '0 4px 20px rgba(99,102,241,0.45)' }}
          >
            {expired ? 'Reactivate now →' : 'Choose your plan →'}
          </a>
          <p className="text-xs" style={{ color: '#475569' }}>Cancel anytime. No hidden fees.</p>
        </div>
      </div>
    </div>
  );
}

function EMRProvisionBanner() {
  const { role: platformRole } = useAuth();
  const { data: clientData, isLoading } = useSWR<ClientResponse>('/clients', fetcher);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  const status = clientData?.data?.emrProvisioningStatus;
  // EMR provisioning is only relevant for the operator admin account
  if (platformRole !== 'admin' || isLoading || dismissed || status === 'provisioned' || status === 'pending') return null;

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

function GBPNudgeBanner() {
  const { data: clientData } = useSWR<ClientResponse>('/clients', fetcher);
  const { data: integrationsData } = useSWR<IntegrationsResponse>('/integrations', fetcher);
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;
  // Only show once onboarding is fully complete
  if ((clientData?.data?.onboardingStep ?? 0) < 4) return null;
  // Hide once Google is connected
  const googleConnected = (integrationsData?.data ?? []).some(
    (i) => i.provider === 'google' && i.status === 'connected',
  );
  if (googleConnected) return null;
  // Wait for both fetches before rendering to avoid flash
  if (!clientData || !integrationsData) return null;

  return (
    <div className="flex items-center justify-between p-4 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-800">
      <div className="flex items-center gap-2">
        <svg className="w-4 h-4 text-blue-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <span>
          <strong>Optional:</strong> Connect your Google Business Profile to unlock review sync and ranking data.
        </span>
      </div>
      <div className="flex items-center gap-3 ml-4 shrink-0">
        <Link to="/dashboard/settings?tab=integrations" className="font-medium underline hover:no-underline whitespace-nowrap">
          Connect Google →
        </Link>
        <button onClick={() => setDismissed(true)} className="text-blue-500 hover:text-blue-700 font-bold">
          ×
        </button>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { isLite, loading: planLoading } = useClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [linkedDismissed, setLinkedDismissed] = useState(false);
  const showLinkedBanner = searchParams.get('linked') === '1' && !linkedDismissed;

  const dismissLinked = () => {
    setLinkedDismissed(true);
    setSearchParams((p) => { p.delete('linked'); return p; }, { replace: true });
  };

  const { data: billingData } = useSWR<BillingStatusResponse>('/billing/status', fetcher, { refreshInterval: 60000 });
  const billing = billingData?.data;

  const { data: metricsData, isLoading: metricsLoading, error: metricsError } =
    useSWR<MetricsResponse>('/metrics', fetcher);

  const { data: rankingsData, isLoading: rankingsLoading, error: rankingsError } =
    useSWR<RankingsResponse>('/rankings?limit=10', fetcher);

  // ROI and SEO Audit are Pro features — skip those fetches for Lite (would 403).
  // Wait until the plan is known (planLoading) so a Lite user doesn't fire a transient 403.
  const { data: roiData } = useSWR<RoiResponse>(planLoading || isLite ? null : '/analytics/roi', fetcher);

  const { data: visData } = useSWR<{ success: boolean; data: { current: number | null; delta: number | null; series: Array<{ date: string; score: number }> } }>('/metrics/visibility', fetcher);
  const vis = visData?.data;

  const { data: auditData } = useSWR<{ success: boolean; data: { audits: Array<{ locationId: string; status: string; compositeScore: number | null }> } }>(planLoading || isLite ? null : '/audits/bl', fetcher);
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
      <GBPNudgeBanner />
      <PastDueBanner billing={billing} />
      <SubscribeCTA billing={billing} />

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

      {/* Secondary metric row — SEO Audit & Citations are Pro-only */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        {!isLite && <MetricCard label="Local SEO Score" value={latestAuditScore != null ? `${latestAuditScore.toFixed(0)}/100` : '—'} loading={!auditData} />}
        {!isLite && <MetricCard label="Citation Score" value={metrics?.citationScore != null ? `${metrics.citationScore}/100` : '—'} loading={metricsLoading} />}
        <VisibilityCard vis={vis} loading={!visData} />
      </div>

      {/* ROI section — Pro only */}
      {!isLite && (roiConfigured && roi ? (
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
        <div className="bg-white rounded-xl shadow-card px-5 py-4 flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-slate-900">Unlock your ROI estimate</p>
            <p className="text-xs text-slate-500 mt-0.5">Enter your average customer value to see the monthly $ impact of your rankings.</p>
          </div>
          <Link to="/dashboard/rankings?roi=1" className="shrink-0 ml-4 bg-brand-500 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-brand-600 transition-colors">Set it up →</Link>
        </div>
      ))}

      {/* Quick actions row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: 'Track Keywords',  to: '/dashboard/rankings',      Icon: TrendingUp  },
          { label: 'View Reviews',    to: '/dashboard/reviews',       Icon: Star        },
          // SEO Audit is Pro-only
          ...(isLite ? [] : [{ label: 'Run SEO Audit', to: '/dashboard/audit', Icon: ClipboardList }]),
          { label: 'Generate Report', to: '/dashboard/reports',       Icon: FileText    },
        ].map(({ label, to, Icon }) => (
          <Link
            key={label}
            to={to}
            className="bg-white rounded-xl shadow-card p-5 flex items-center gap-3 hover:shadow-card-md transition-shadow group"
          >
            <Icon size={20} className="text-brand-500 shrink-0" />
            <span className="text-sm font-medium text-slate-700 group-hover:text-brand-600 transition-colors">{label}</span>
          </Link>
        ))}
      </div>

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
