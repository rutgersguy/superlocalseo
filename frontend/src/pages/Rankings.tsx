import { useState } from 'react';
import useSWR from 'swr';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { apiFetch, fetcher } from '../services/api';

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

interface TrendPoint {
  date: string;
  rank: number;
}

interface RoiKeyword {
  keywordId: string;
  keyword: string;
  location: string;
  locationId: string;
  monthlySearchVolume: number | null;
  rank: number | null;
  ctr: number | null;
  estClicks: number | null;
  estLeads: number | null;
  estRevenue: number | null;
}

interface RoiData {
  roiConfig: { avgCustomerValue: number; conversionRate: number };
  keywords: RoiKeyword[];
  totals: { estClicks: number; estLeads: number; estRevenue: number };
}

type SortKey = keyof Pick<RankingRow, 'keyword' | 'location' | 'rank' | 'delta' | 'pulledAt'>;
type TrendRange = 30 | 90 | 365;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function DeltaBadge({ delta }: { delta: number }) {
  if (delta === 0) {
    return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-500">—</span>;
  }
  const improved = delta > 0;
  return (
    <span className={`inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-xs font-medium ${improved ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>
      {improved ? '▲' : '▼'} {Math.abs(delta)}
    </span>
  );
}

function SortIcon({ active, dir }: { active: boolean; dir: 'asc' | 'desc' }) {
  if (!active) return <span className="text-gray-300 ml-1">↕</span>;
  return <span className="text-brand-500 ml-1">{dir === 'asc' ? '↑' : '↓'}</span>;
}

function fmt$(n: number) {
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}k`;
  return `$${n.toLocaleString()}`;
}

const TREND_RANGES: { label: string; value: TrendRange }[] = [
  { label: '30d', value: 30 },
  { label: '90d', value: 90 },
  { label: 'All', value: 365 },
];

// ─── Inline volume editor ──────────────────────────────────────────────────────

function VolumeCell({ keywordId, value, onSave }: { keywordId: string; value: number | null; onSave: (v: number | null) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);

  const startEdit = () => {
    setDraft(value != null ? String(value) : '');
    setEditing(true);
  };

  const save = async () => {
    setSaving(true);
    const parsed = draft === '' ? null : parseInt(draft, 10);
    const vol = parsed != null && !isNaN(parsed) ? parsed : null;
    try {
      await apiFetch(`/keywords/${keywordId}/volume`, {
        method: 'PATCH',
        body: JSON.stringify({ monthlySearchVolume: vol }),
      });
      onSave(vol);
    } finally {
      setSaving(false);
      setEditing(false);
    }
  };

  if (editing) {
    return (
      <div className="flex items-center gap-1">
        <input
          type="number"
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void save(); if (e.key === 'Escape') setEditing(false); }}
          className="w-20 border border-brand-400 rounded px-1.5 py-0.5 text-xs focus:outline-none"
          placeholder="e.g. 500"
        />
        <button onClick={() => void save()} disabled={saving} className="text-xs text-brand-500 font-medium">{saving ? '…' : '✓'}</button>
        <button onClick={() => setEditing(false)} className="text-xs text-gray-400">✕</button>
      </div>
    );
  }

  return (
    <button onClick={startEdit} className="text-sm text-gray-500 hover:text-brand-500 hover:underline tabular-nums" title="Click to set monthly search volume">
      {value != null ? value.toLocaleString() : <span className="text-gray-300">set vol.</span>}
    </button>
  );
}

// ─── ROI config panel ─────────────────────────────────────────────────────────

function RoiConfigPanel({ config, onSave }: { config: { avgCustomerValue: number; conversionRate: number }; onSave: () => void }) {
  const [acv, setAcv] = useState(String(config.avgCustomerValue || ''));
  const [conv, setConv] = useState(String(config.conversionRate));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await apiFetch('/analytics/roi-config', {
        method: 'PATCH',
        body: JSON.stringify({
          avgCustomerValue: parseFloat(acv) || 0,
          conversionRate: parseFloat(conv) || 2.5,
        }),
      });
      onSave();
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
      <h2 className="text-sm font-semibold text-gray-900 mb-1">ROI Settings</h2>
      <p className="text-xs text-gray-500 mb-4">Used to estimate the monthly revenue value of your keyword rankings.</p>
      <div className="flex flex-wrap gap-4 items-end">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Avg. customer value ($)</label>
          <input
            type="number"
            min={0}
            value={acv}
            onChange={(e) => setAcv(e.target.value)}
            placeholder="e.g. 350"
            className="w-32 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Conversion rate (%)</label>
          <input
            type="number"
            min={0}
            max={100}
            step={0.1}
            value={conv}
            onChange={(e) => setConv(e.target.value)}
            placeholder="2.5"
            className="w-28 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>
        <div className="flex items-center gap-2 pb-0.5">
          <button
            onClick={() => void save()}
            disabled={saving}
            className="px-4 py-2 bg-brand-500 text-white rounded-lg text-sm font-medium hover:bg-brand-600 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
          {saved && <span className="text-xs text-green-600 font-medium">Saved!</span>}
        </div>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function Rankings() {
  const [sortKey, setSortKey] = useState<SortKey>('rank');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [selectedRow, setSelectedRow] = useState<RankingRow | null>(null);
  const [trendRange, setTrendRange] = useState<TrendRange>(30);
  const [showRoi, setShowRoi] = useState(false);
  const [localVolumes, setLocalVolumes] = useState<Record<string, number | null>>({});

  const { data: rankingsData, isLoading, error } = useSWR<{ success: boolean; data: RankingRow[] }>('/rankings', fetcher);
  const { data: roiData, mutate: roiMutate } = useSWR<{ success: boolean; data: RoiData }>('/analytics/roi', fetcher);

  const trendKey = selectedRow
    ? `/rankings/trend?keywordId=${selectedRow.keywordId}&locationId=${selectedRow.locationId}&days=${trendRange}`
    : null;
  const { data: trendData, isLoading: trendLoading } = useSWR<{ success: boolean; data: TrendPoint[] }>(trendKey, fetcher);

  const rows = rankingsData?.data ?? [];
  const effectiveSelected = selectedRow ?? (rows[0] ?? null);
  const roiByKeyword = Object.fromEntries((roiData?.data?.keywords ?? []).map((k) => [k.keywordId, k]));

  const sorted = [...rows].sort((a, b) => {
    const av = a[sortKey] ?? 0;
    const bv = b[sortKey] ?? 0;
    const cmp = typeof av === 'number' && typeof bv === 'number'
      ? av - bv
      : String(av).localeCompare(String(bv));
    return sortDir === 'asc' ? cmp : -cmp;
  });

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('asc'); }
  };

  const trendPoints = trendData?.data ?? [];
  const ranks = trendPoints.map((p) => p.rank);
  const yMin = ranks.length ? Math.min(...ranks) - 2 : 1;
  const yMax = ranks.length ? Math.max(...ranks) + 2 : 20;

  const totals = roiData?.data?.totals;
  const roiConfig = roiData?.data?.roiConfig;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Rankings</h1>
          <p className="text-sm text-gray-500 mt-1">Keyword ranking performance across all locations</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowRoi((v) => !v)}
            className={`px-4 py-2 text-sm font-medium rounded-lg border transition-colors ${showRoi ? 'bg-brand-500 text-white border-brand-500' : 'text-gray-600 border-gray-300 hover:bg-gray-50'}`}
          >
            ROI
          </button>
          <button onClick={() => { window.location.href = '/api/analytics/export?type=rankings'; }} className="px-4 py-2 text-sm font-medium text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50">
            Export CSV
          </button>
        </div>
      </div>

      {/* ROI panel */}
      {showRoi && roiConfig && (
        <RoiConfigPanel config={roiConfig} onSave={() => void roiMutate()} />
      )}

      {/* ROI summary bar */}
      {showRoi && totals && roiConfig && roiConfig.avgCustomerValue > 0 && (
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: 'Est. Monthly Clicks', value: totals.estClicks.toLocaleString() },
            { label: 'Est. Monthly Leads', value: totals.estLeads.toLocaleString() },
            { label: 'Est. Monthly Revenue', value: fmt$(totals.estRevenue) },
          ].map((card) => (
            <div key={card.label} className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
              <p className="text-xs text-gray-500 mb-1">{card.label}</p>
              <p className="text-2xl font-bold text-gray-900">{card.value}</p>
            </div>
          ))}
        </div>
      )}

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
                {(['keyword', 'location', 'rank', 'delta', 'pulledAt'] as SortKey[]).map((key) => {
                  const labels: Record<SortKey, string> = { keyword: 'Keyword', location: 'Location', rank: 'Rank', delta: 'Change', pulledAt: 'Updated' };
                  const right = ['rank', 'delta'].includes(key);
                  return (
                    <th key={key} onClick={() => handleSort(key)} className={`px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide cursor-pointer hover:text-gray-900 select-none ${right ? 'text-right' : 'text-left'}`}>
                      {labels[key]}<SortIcon active={sortKey === key} dir={sortDir} />
                    </th>
                  );
                })}
                {showRoi && (
                  <>
                    <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide text-right">Search Vol.</th>
                    <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide text-right">Est. Revenue</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {sorted.length === 0 ? (
                <tr>
                  <td colSpan={showRoi ? 7 : 5} className="px-6 py-10 text-center text-gray-400">
                    No ranking data available.
                  </td>
                </tr>
              ) : (
                sorted.map((row) => {
                  const roi = roiByKeyword[row.keywordId];
                  const localVol = row.keywordId in localVolumes ? localVolumes[row.keywordId] : roi?.monthlySearchVolume ?? null;
                  return (
                    <tr
                      key={row.keywordId}
                      onClick={() => setSelectedRow(row)}
                      className={`cursor-pointer transition-colors ${effectiveSelected?.keywordId === row.keywordId ? 'bg-brand-50' : 'hover:bg-gray-50'}`}
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
                      {showRoi && (
                        <>
                          <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                            <VolumeCell
                              keywordId={row.keywordId}
                              value={localVol}
                              onSave={(v) => {
                                setLocalVolumes((prev) => ({ ...prev, [row.keywordId]: v }));
                                void roiMutate();
                              }}
                            />
                          </td>
                          <td className="px-4 py-3 text-right font-medium text-gray-700 tabular-nums">
                            {roi?.estRevenue != null ? fmt$(roi.estRevenue) : <span className="text-gray-300 text-xs">—</span>}
                          </td>
                        </>
                      )}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        )}
      </div>

      {/* Trend chart */}
      {effectiveSelected && (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h2 className="text-base font-semibold text-gray-900">Rank Trend — {effectiveSelected.keyword}</h2>
              <p className="text-xs text-gray-500 mt-0.5">{effectiveSelected.location}</p>
            </div>
            <div className="flex gap-1">
              {TREND_RANGES.map((r) => (
                <button key={r.value} onClick={() => setTrendRange(r.value)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${trendRange === r.value ? 'bg-brand-500 text-white' : 'text-gray-500 hover:text-gray-900 hover:bg-gray-100'}`}>
                  {r.label}
                </button>
              ))}
            </div>
          </div>
          {trendLoading ? (
            <div className="h-48 flex items-center justify-center text-sm text-gray-400">Loading trend...</div>
          ) : trendPoints.length === 0 ? (
            <div className="h-48 flex items-center justify-center text-sm text-gray-400">No trend data available for this period.</div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={trendPoints} margin={{ top: 4, right: 16, bottom: 4, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#9ca3af' }}
                  tickFormatter={(v: string) => v ? new Date(v).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''} />
                <YAxis domain={[yMax, yMin]} reversed tick={{ fontSize: 11, fill: '#9ca3af' }} width={28} />
                <Tooltip formatter={(value: number) => [`Rank ${value}`, 'Rank']}
                  labelFormatter={(label: string) => label ? new Date(label).toLocaleDateString() : ''} />
                <Line type="monotone" dataKey="rank" stroke="#0052CC" strokeWidth={2} dot={{ r: 3, fill: '#0052CC' }} activeDot={{ r: 5 }} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      )}
    </div>
  );
}
