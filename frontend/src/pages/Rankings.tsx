import { useState } from 'react';
import useSWR from 'swr';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { fetcher } from '../services/api';

// ─── Types ────────────────────────────────────────────────────────────────────

interface RankingRow {
  keywordId: string;
  keyword: string;
  locationId: string;
  location: string;
  rank: number;
  delta: number | null;
  pulledAt: string;
}

interface RankingsResponse {
  success: boolean;
  data: RankingRow[];
}

interface TrendPoint {
  date: string;
  rank: number;
}

interface TrendResponse {
  success: boolean;
  data: TrendPoint[];
}

type SortKey = keyof Pick<RankingRow, 'keyword' | 'location' | 'rank' | 'delta' | 'pulledAt'>;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function DeltaBadge({ delta }: { delta: number }) {
  if (delta === 0) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-500">
        No change
      </span>
    );
  }
  const improved = delta < 0;
  return (
    <span
      className={`inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-xs font-medium ${
        improved ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'
      }`}
    >
      {improved ? '▲' : '▼'} {Math.abs(delta)}
    </span>
  );
}

function SortIcon({ active, dir }: { active: boolean; dir: 'asc' | 'desc' }) {
  if (!active) return <span className="text-gray-300 ml-1">↕</span>;
  return <span className="text-brand-500 ml-1">{dir === 'asc' ? '↑' : '↓'}</span>;
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function Rankings() {
  const [sortKey, setSortKey] = useState<SortKey>('rank');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [selectedRow, setSelectedRow] = useState<RankingRow | null>(null);

  const { data: rankingsData, isLoading, error } = useSWR<RankingsResponse>('/rankings', fetcher);

  // Build SWR key for trend (only after a row is selected)
  const trendKey = selectedRow
    ? `/rankings/trend?keywordId=${selectedRow.keywordId}&locationId=${selectedRow.locationId}&days=30`
    : null;

  const { data: trendData, isLoading: trendLoading } = useSWR<TrendResponse>(trendKey, fetcher);

  const rows = rankingsData?.data ?? [];

  // Determine default selected row
  const effectiveSelected = selectedRow ?? (rows[0] ?? null);

  // Sort rows
  const sorted = [...rows].sort((a, b) => {
    const av = a[sortKey] ?? 0;
    const bv = b[sortKey] ?? 0;
    const cmp = typeof av === 'number' && typeof bv === 'number'
      ? av - bv
      : String(av).localeCompare(String(bv));
    return sortDir === 'asc' ? cmp : -cmp;
  });

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const trendPoints = trendData?.data ?? [];

  // Y-axis domain: reversed so lower rank (better) is at top
  const ranks = trendPoints.map((p) => p.rank);
  const yMin = ranks.length ? Math.min(...ranks) - 2 : 1;
  const yMax = ranks.length ? Math.max(...ranks) + 2 : 20;

  const cols: { key: SortKey; label: string; align?: string }[] = [
    { key: 'keyword', label: 'Keyword' },
    { key: 'location', label: 'Location' },
    { key: 'rank', label: 'Current Rank', align: 'right' },
    { key: 'delta', label: 'Change', align: 'right' },
    { key: 'pulledAt', label: 'Last Updated' },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Rankings</h1>
        <p className="text-sm text-gray-500 mt-1">Keyword ranking performance across all locations</p>
      </div>

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          Failed to load rankings. Please refresh.
        </div>
      )}

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-x-auto">
        {isLoading ? (
          <div className="p-8 text-center text-sm text-gray-400">Loading rankings...</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                {cols.map((col) => (
                  <th
                    key={col.key}
                    onClick={() => handleSort(col.key)}
                    className={`px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide cursor-pointer hover:text-gray-900 select-none ${
                      col.align === 'right' ? 'text-right' : 'text-left'
                    }`}
                  >
                    {col.label}
                    <SortIcon active={sortKey === col.key} dir={sortDir} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {sorted.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-10 text-center text-gray-400">
                    No ranking data available.
                  </td>
                </tr>
              ) : (
                sorted.map((row) => (
                  <tr
                    key={row.keywordId}
                    onClick={() => setSelectedRow(row)}
                    className={`cursor-pointer transition-colors ${
                      effectiveSelected?.keywordId === row.keywordId ? 'bg-brand-50' : 'hover:bg-gray-50'
                    }`}
                  >
                    <td className="px-6 py-3 font-medium text-gray-900">{row.keyword}</td>
                    <td className="px-6 py-3 text-gray-500">{row.location ?? '—'}</td>
                    <td className="px-6 py-3 text-right font-semibold text-gray-900">{row.rank}</td>
                    <td className="px-6 py-3 text-right">
                      {row.delta != null ? <DeltaBadge delta={row.delta} /> : <span className="text-gray-400 text-sm">—</span>}
                    </td>
                    <td className="px-6 py-3 text-gray-500">
                      {row.pulledAt ? new Date(row.pulledAt).toLocaleDateString() : '—'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        )}
      </div>

      {/* Trend chart */}
      {effectiveSelected && (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
          <h2 className="text-base font-semibold text-gray-900 mb-1">
            Rank Trend — {effectiveSelected.keyword}
          </h2>
          <p className="text-xs text-gray-500 mb-4">{effectiveSelected.location} · Last 30 days</p>

          {trendLoading ? (
            <div className="h-48 flex items-center justify-center text-sm text-gray-400">
              Loading trend...
            </div>
          ) : trendPoints.length === 0 ? (
            <div className="h-48 flex items-center justify-center text-sm text-gray-400">
              No trend data available.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={trendPoints} margin={{ top: 4, right: 16, bottom: 4, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 11, fill: '#9ca3af' }}
                  tickFormatter={(v: string) => v ? new Date(v).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''}
                />
                <YAxis
                  domain={[yMax, yMin]}
                  reversed
                  tick={{ fontSize: 11, fill: '#9ca3af' }}
                  width={28}
                />
                <Tooltip
                  formatter={(value: number) => [`Rank ${value}`, 'Rank']}
                  labelFormatter={(label: string) => label ? new Date(label).toLocaleDateString() : ''}
                />
                <Line
                  type="monotone"
                  dataKey="rank"
                  stroke="#0052CC"
                  strokeWidth={2}
                  dot={{ r: 3, fill: '#0052CC' }}
                  activeDot={{ r: 5 }}
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      )}
    </div>
  );
}
