import useSWR from 'swr';
import { fetcher } from '../services/api';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Metrics {
  avgRank: number;
  keywordsInTop10: number;
  totalReviews: number;
  avgRating: number;
}

interface MetricsResponse {
  success: boolean;
  data: Metrics;
}

interface RankingRow {
  id: string;
  keyword: string;
  location: string;
  rank: number;
  delta: number;
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

// ─── Main component ───────────────────────────────────────────────────────────

export default function Dashboard() {
  const { data: metricsData, isLoading: metricsLoading, error: metricsError } =
    useSWR<MetricsResponse>('/metrics', fetcher);

  const { data: rankingsData, isLoading: rankingsLoading, error: rankingsError } =
    useSWR<RankingsResponse>('/rankings?limit=10', fetcher);

  const metrics = metricsData?.data;
  const rankings = rankingsData?.data ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-sm text-gray-500 mt-1">Overview of your local SEO performance</p>
      </div>

      {/* Error state */}
      {metricsError && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          Failed to load metrics. Please refresh.
        </div>
      )}

      {/* Metric cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          label="Avg Rank"
          value={metrics ? metrics.avgRank.toFixed(1) : '—'}
          loading={metricsLoading}
        />
        <MetricCard
          label="Keywords in Top 10"
          value={metrics ? metrics.keywordsInTop10 : '—'}
          loading={metricsLoading}
        />
        <MetricCard
          label="Total Reviews"
          value={metrics ? metrics.totalReviews : '—'}
          loading={metricsLoading}
        />
        <MetricCard
          label="Avg Rating"
          value={metrics ? metrics.avgRating.toFixed(1) : '—'}
          loading={metricsLoading}
        />
      </div>

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
                    <tr key={row.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-6 py-3 font-medium text-gray-900">{row.keyword}</td>
                      <td className="px-6 py-3 text-gray-500">{row.location}</td>
                      <td className="px-6 py-3 text-right font-semibold text-gray-900">{row.rank}</td>
                      <td className="px-6 py-3 text-right">
                        <DeltaBadge delta={row.delta} />
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
