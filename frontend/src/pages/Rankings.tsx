import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import useSWR from 'swr';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { MapContainer, CircleMarker, Popup, TileLayer } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
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
type TrendRange = 30 | 90 | 0;
type RankTypeFilter = 'all' | 'organic' | 'local_pack' | 'paid';
type MainTab = 'table' | 'map';

// ─── Geo-Grid types ────────────────────────────────────────────────────────────

interface GridPoint { lat: number; lng: number; rank: number | null; url: string | null; }
interface GeoReport { id: string; locationId: string; keywordId: string; status: string; centerLat: number; centerLng: number; gridData: GridPoint[] | null; completedAt: string | null; createdAt: string; }
interface GeoReportsResponse { success: boolean; data: { reports: GeoReport[] }; }
interface LocationOption { id: string; name: string; city?: string; state?: string; }
interface LocationsResponse { success: boolean; data: LocationOption[]; }
interface KeywordItem { id: string; locationId: string; keyword: string; }
interface KeywordsListResponse { success: boolean; data: KeywordItem[]; }

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
  { label: 'All', value: 0 },
];

const RANK_TYPES: { label: string; value: RankTypeFilter }[] = [
  { label: 'All', value: 'all' },
  { label: 'Organic', value: 'organic' },
  { label: 'Local Pack', value: 'local_pack' },
  { label: 'Paid', value: 'paid' },
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

// ─── Keywords panel ──────────────────────────────────────────────────────────

function KeywordsPanel({ onChanged }: { onChanged: () => void }) {
  const { data: locData } = useSWR<LocationsResponse>('/locations', fetcher);
  const locations = locData?.data ?? [];
  const [activeLocationId, setActiveLocationId] = useState('');
  const [newKeyword, setNewKeyword] = useState('');
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  useEffect(() => {
    if (locations.length > 0 && !activeLocationId) setActiveLocationId(locations[0].id);
  }, [locations, activeLocationId]);

  const kwUrl = activeLocationId ? `/keywords?locationId=${activeLocationId}` : null;
  const { data: kwData, mutate: mutateKw } = useSWR<KeywordsListResponse>(kwUrl, fetcher);
  const keywords = kwData?.data ?? [];

  const handleAdd = async () => {
    const kw = newKeyword.trim();
    if (!kw || !activeLocationId) return;
    setAdding(true);
    setAddError(null);
    try {
      const res = await apiFetch<{ success: boolean; error?: { message: string } }>('/keywords', {
        method: 'POST',
        body: JSON.stringify({ locationId: activeLocationId, keyword: kw }),
      });
      if (!(res as { success: boolean }).success) {
        setAddError((res as { error?: { message: string } }).error?.message ?? 'Failed to add keyword');
        return;
      }
      setNewKeyword('');
      await mutateKw();
      onChanged();
    } finally {
      setAdding(false);
    }
  };

  const handleDelete = async (id: string) => {
    await apiFetch(`/keywords/${id}`, { method: 'DELETE' }, true);
    await mutateKw();
    onChanged();
  };

  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">Manage Keywords</h2>
          <p className="text-xs text-gray-500 mt-0.5">Keywords are tracked per location. New keywords appear in the table below after the next scheduled scan.</p>
        </div>
        <select
          value={activeLocationId}
          onChange={(e) => setActiveLocationId(e.target.value)}
          className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-500 min-w-[180px]"
        >
          {locations.map((l) => (
            <option key={l.id} value={l.id}>{[l.name, l.city, l.state].filter(Boolean).join(', ')}</option>
          ))}
        </select>
      </div>
      {!activeLocationId ? (
        <p className="text-sm text-gray-400">Select a location to manage its keywords.</p>
      ) : (
        <div className="space-y-2">
          {keywords.length > 0 && (
            <div className="divide-y divide-gray-100 rounded-lg border border-gray-100 overflow-hidden">
              {keywords.map((kw) => (
                <div key={kw.id} className="flex items-center justify-between px-3 py-2 bg-gray-50">
                  <span className="text-sm text-gray-800">{kw.keyword}</span>
                  <button onClick={() => void handleDelete(kw.id)} className="text-red-400 hover:text-red-600 text-xs font-medium ml-4">Remove</button>
                </div>
              ))}
            </div>
          )}
          {keywords.length === 0 && <p className="text-sm text-gray-400">No keywords yet for this location.</p>}
          {addError && <p className="text-xs text-red-500">{addError}</p>}
          <div className="flex gap-2">
            <input
              type="text"
              value={newKeyword}
              onChange={(e) => { setNewKeyword(e.target.value); setAddError(null); }}
              onKeyDown={(e) => { if (e.key === 'Enter') void handleAdd(); }}
              placeholder="e.g. plumber near me"
              className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
            <button
              onClick={() => void handleAdd()}
              disabled={adding || !newKeyword.trim() || !activeLocationId}
              className="px-4 py-2 text-sm font-medium bg-brand-500 text-white rounded-lg hover:bg-brand-600 disabled:opacity-50"
            >
              {adding ? 'Adding…' : 'Add'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

// ─── Geo-Grid panel ────────────────────────────────────────────────────────────

function rankColor(rank: number | null): string {
  if (rank == null) return '#6b7280';
  if (rank <= 3) return '#16a34a';
  if (rank <= 10) return '#ca8a04';
  if (rank <= 20) return '#ea580c';
  return '#dc2626';
}

function GeoGridPanel() {
  const [selectedLocationId, setSelectedLocationId] = useState('');
  const [selectedKeywordId, setSelectedKeywordId] = useState('');
  const [triggering, setTriggering] = useState(false);
  const [triggerError, setTriggerError] = useState<string | null>(null);
  const [pollingId, setPollingId] = useState<string | null>(null);

  const { data: locData } = useSWR<LocationsResponse>('/locations', fetcher);
  const locations = locData?.data ?? [];

  const kwKey = selectedLocationId ? `/keywords?locationId=${selectedLocationId}` : null;
  const { data: kwData } = useSWR<KeywordsListResponse>(kwKey, fetcher);
  const keywords = kwData?.data ?? [];

  const reportsKey = selectedLocationId && selectedKeywordId
    ? `/geo-grid?locationId=${selectedLocationId}&keywordId=${selectedKeywordId}`
    : null;
  const { data: reportsData, mutate: mutateReports } = useSWR<GeoReportsResponse>(reportsKey, fetcher);
  const reports = reportsData?.data?.reports ?? [];
  const latestReport = reports[0] ?? null;

  useEffect(() => {
    if (!pollingId) return;
    const interval = setInterval(() => {
      void mutateReports();
      const updated = reports.find((r) => r.id === pollingId);
      if (updated && updated.status !== 'processing') {
        setPollingId(null);
        clearInterval(interval);
      }
    }, 10000);
    return () => clearInterval(interval);
  }, [pollingId, reports, mutateReports]);

  const handleTrigger = async () => {
    if (!selectedLocationId || !selectedKeywordId) return;
    setTriggering(true);
    setTriggerError(null);
    try {
      const res = await apiFetch('/geo-grid', {
        method: 'POST',
        body: JSON.stringify({ locationId: selectedLocationId, keywordId: selectedKeywordId }),
      }) as { data?: { report?: GeoReport } };
      if (res.data?.report) setPollingId(res.data.report.id);
      await mutateReports();
    } catch (e) {
      setTriggerError((e as Error).message ?? 'Failed to start scan');
    } finally {
      setTriggering(false);
    }
  };

  const effectiveLat = latestReport?.centerLat ?? 40.7128;
  const effectiveLng = latestReport?.centerLng ?? -74.006;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 items-end">
        <div>
          <label className="block text-xs text-gray-500 mb-1">Location</label>
          <select value={selectedLocationId} onChange={(e) => setSelectedLocationId(e.target.value)}
            className="text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500">
            <option value="">Select location…</option>
            {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Keyword</label>
          <select value={selectedKeywordId} onChange={(e) => setSelectedKeywordId(e.target.value)}
            className="text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500">
            <option value="">Select keyword…</option>
            {keywords.map((k) => <option key={k.id} value={k.id}>{k.keyword}</option>)}
          </select>
        </div>
        <button onClick={() => void handleTrigger()} disabled={triggering || !selectedLocationId || !selectedKeywordId}
          className="px-4 py-2 text-sm font-medium bg-brand-600 text-white rounded-lg hover:bg-brand-700 disabled:opacity-50">
          {triggering ? 'Starting…' : 'Run Scan'}
        </button>
      </div>

      {triggerError && <p className="text-sm text-red-600">{triggerError}</p>}

      {latestReport?.status === 'processing' && (
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <div className="h-4 w-4 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
          Generating visibility map… (can take up to 10 minutes)
        </div>
      )}

      {latestReport?.status === 'complete' && latestReport.gridData && (
        <>
          <div className="h-96 rounded-xl overflow-hidden border border-gray-200">
            <MapContainer center={[effectiveLat, effectiveLng]} zoom={12} style={{ height: '100%', width: '100%' }} scrollWheelZoom={false}>
              <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' />
              {latestReport.gridData.map((point, i) => (
                <CircleMarker key={i} center={[point.lat, point.lng]} radius={16}
                  fillColor={rankColor(point.rank)} color={rankColor(point.rank)} fillOpacity={0.7} weight={1}>
                  <Popup>
                    {point.rank != null ? `Rank #${point.rank}` : 'Not ranked'}
                    {point.url && <><br /><a href={point.url} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-500 break-all">{point.url}</a></>}
                  </Popup>
                </CircleMarker>
              ))}
            </MapContainer>
          </div>
          {(() => {
            const cells = latestReport.gridData;
            const ranked = cells.filter((c) => c.rank != null);
            const top3 = cells.filter((c) => c.rank != null && c.rank <= 3).length;
            const top10 = cells.filter((c) => c.rank != null && c.rank <= 10).length;
            const avgRank = ranked.length > 0 ? (ranked.reduce((s, c) => s + (c.rank ?? 0), 0) / ranked.length).toFixed(1) : '—';
            return (
              <div className="grid grid-cols-3 gap-4">
                {[
                  { label: 'Avg Grid Rank', value: avgRank },
                  { label: '% in Top 3', value: `${cells.length > 0 ? Math.round(top3 / cells.length * 100) : 0}%` },
                  { label: '% in Top 10', value: `${cells.length > 0 ? Math.round(top10 / cells.length * 100) : 0}%` },
                ].map((s) => (
                  <div key={s.label} className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 text-center">
                    <p className="text-xs text-gray-500 mb-1">{s.label}</p>
                    <p className="text-xl font-bold text-gray-900">{s.value}</p>
                  </div>
                ))}
              </div>
            );
          })()}
        </>
      )}

      {!latestReport && selectedLocationId && selectedKeywordId && (
        <div className="py-12 text-center text-gray-400 text-sm">No scan yet. Click "Run Scan" to generate a visibility map.</div>
      )}

      <div className="flex gap-4 text-xs text-gray-500 flex-wrap">
        {[{ color: '#16a34a', label: '#1–3' }, { color: '#ca8a04', label: '#4–10' }, { color: '#ea580c', label: '#11–20' }, { color: '#dc2626', label: '#21+' }, { color: '#6b7280', label: 'Not ranked' }].map((l) => (
          <span key={l.label} className="flex items-center gap-1">
            <span className="inline-block w-3 h-3 rounded-full" style={{ background: l.color }} />
            {l.label}
          </span>
        ))}
      </div>
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────

export default function Rankings() {
  const [searchParams] = useSearchParams();
  const [sortKey, setSortKey] = useState<SortKey>('rank');
  const [mainTab, setMainTab] = useState<MainTab>('table');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [selectedRow, setSelectedRow] = useState<RankingRow | null>(null);
  const [trendRange, setTrendRange] = useState<TrendRange>(30);
  const [rankType, setRankType] = useState<RankTypeFilter>('all');
  const [showRoi, setShowRoi] = useState(() => searchParams.get('roi') === '1');
  const [showKeywords, setShowKeywords] = useState(false);
  const [localVolumes, setLocalVolumes] = useState<Record<string, number | null>>({});
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<{ text: string; ok: boolean } | null>(null);

  const rankingsUrl = rankType !== 'all' ? `/rankings?rankType=${rankType}` : '/rankings';
  const { data: rankingsData, isLoading, error, mutate: mutateRankings } = useSWR<{ success: boolean; data: RankingRow[] }>(rankingsUrl, fetcher);
  const { data: roiData, mutate: roiMutate } = useSWR<{ success: boolean; data: RoiData }>('/analytics/roi', fetcher);
  const { data: allKwData, mutate: mutateAllKw } = useSWR<KeywordsListResponse>('/keywords', fetcher);
  const { data: locData } = useSWR<LocationsResponse>('/locations', fetcher);

  const trendKey = selectedRow
    ? `/rankings/trend?keywordId=${selectedRow.keywordId}&locationId=${selectedRow.locationId}${trendRange > 0 ? `&days=${trendRange}` : ''}${rankType !== 'all' ? `&rankType=${rankType}` : ''}`
    : null;
  const { data: trendData, isLoading: trendLoading } = useSWR<{ success: boolean; data: TrendPoint[] }>(trendKey, fetcher);

  const rows = rankingsData?.data ?? [];
  const effectiveSelected = selectedRow ?? (rows[0] ?? null);
  const roiByKeyword = Object.fromEntries((roiData?.data?.keywords ?? []).map((k) => [k.keywordId, k]));

  const locationMap = Object.fromEntries((locData?.data ?? []).map((l) => [l.id, l]));
  const rankedKeywordIds = new Set(rows.map((r) => r.keywordId));
  const pendingKeywords = (allKwData?.data ?? []).filter((k) => !rankedKeywordIds.has(k.id));

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

  const handleSync = async () => {
    setSyncing(true);
    setSyncMessage(null);
    try {
      const res = await apiFetch<{ success: boolean; message?: string; error?: { message: string } }>('/rankings/sync', { method: 'POST' });
      const msg = (res as { message?: string; error?: { message: string } }).message ?? (res as { error?: { message: string } }).error?.message ?? 'Done.';
      setSyncMessage({ text: msg, ok: (res as { success: boolean }).success });
      if ((res as { success: boolean }).success) {
        await mutateRankings();
        await mutateAllKw();
      }
    } catch (e) {
      setSyncMessage({ text: (e as Error).message ?? 'Sync failed.', ok: false });
    } finally {
      setSyncing(false);
    }
  };

  const trendPoints = trendData?.data ?? [];
  const ranks = trendPoints.map((p) => p.rank);
  const yMin = ranks.length ? Math.min(...ranks) - 2 : 1;
  const yMax = ranks.length ? Math.max(...ranks) + 2 : 20;

  const totals = roiData?.data?.totals;
  const roiConfig = roiData?.data?.roiConfig;
  const roiConfigured = (roiConfig?.avgCustomerValue ?? 0) > 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Rankings</h1>
          <p className="text-sm text-gray-500 mt-1">Keyword ranking performance across all locations</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowKeywords((v) => !v)}
            className={`px-4 py-2 text-sm font-medium rounded-lg border transition-colors ${showKeywords ? 'bg-brand-500 text-white border-brand-500' : 'text-gray-600 border-gray-300 hover:bg-gray-50'}`}
          >
            Keywords
          </button>
          <button
            onClick={() => setShowRoi((v) => !v)}
            className={`px-4 py-2 text-sm font-medium rounded-lg border transition-colors ${showRoi ? 'bg-brand-500 text-white border-brand-500' : 'text-gray-600 border-gray-300 hover:bg-gray-50'}`}
          >
            ROI
          </button>
          <button
            onClick={() => void handleSync()}
            disabled={syncing}
            className="px-4 py-2 text-sm font-medium text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
          >
            {syncing ? 'Syncing…' : 'Sync now'}
          </button>
          <button onClick={() => { window.location.href = '/api/analytics/export?type=rankings'; }} className="px-4 py-2 text-sm font-medium text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50">
            Export CSV
          </button>
        </div>
      </div>

      {/* Sync result message */}
      {syncMessage && (
        <div className={`px-4 py-3 rounded-lg text-sm ${syncMessage.ok ? 'bg-green-50 text-green-800 border border-green-200' : 'bg-amber-50 text-amber-800 border border-amber-200'}`}>
          {syncMessage.text}
        </div>
      )}

      {/* Keywords management panel */}
      {showKeywords && (
        <KeywordsPanel onChanged={() => { void mutateAllKw(); void mutateRankings(); }} />
      )}

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

      {/* Main tab switcher */}
      <div className="flex gap-1 border-b border-gray-200">
        <button onClick={() => setMainTab('table')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${mainTab === 'table' ? 'border-brand-500 text-brand-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
          Rankings Table
        </button>
        <button onClick={() => setMainTab('map')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${mainTab === 'map' ? 'border-brand-500 text-brand-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
          📍 Visibility Map
        </button>
      </div>

      {mainTab === 'map' && (
        <GeoGridPanel />
      )}

      {mainTab === 'table' && (<>
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
                  <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide text-right">Search Vol.</th>
                )}
                <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide text-right">
                  <span className="flex items-center justify-end gap-1">
                    Est. Revenue / mo
                    <span title="Based on your ROI settings" className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full bg-gray-200 text-gray-500 text-[10px] font-bold cursor-help leading-none">i</span>
                  </span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {sorted.length === 0 && pendingKeywords.length === 0 ? (
                <tr>
                  <td colSpan={showRoi ? 7 : 6} className="px-6 py-10 text-center text-gray-400">
                    No keywords yet. Click <strong>Keywords</strong> above to add some.
                  </td>
                </tr>
              ) : (
                <>
                {sorted.map((row) => {
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
                      )}
                      <td className="px-4 py-3 text-right font-medium text-gray-700 tabular-nums">
                        {roiConfigured
                          ? (roi?.estRevenue != null ? fmt$(roi.estRevenue) : <span className="text-gray-300 text-xs">—</span>)
                          : <span className="text-gray-300 text-xs">—</span>
                        }
                      </td>
                    </tr>
                  );
                })}
                {pendingKeywords.map((pk) => {
                  const loc = locationMap[pk.locationId];
                  const locName = loc ? [loc.name, loc.city, loc.state].filter(Boolean).join(', ') : '—';
                  return (
                    <tr key={`pending-${pk.id}`} className="opacity-60">
                      <td className="px-6 py-3 font-medium text-gray-700">{pk.keyword}</td>
                      <td className="px-6 py-3 text-gray-500">{locName}</td>
                      <td className="px-6 py-3 text-right">
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700">Pending scan</span>
                      </td>
                      <td className="px-6 py-3 text-right text-gray-300 text-sm">—</td>
                      <td className="px-6 py-3 text-gray-300 text-sm">—</td>
                      {showRoi && <td className="px-4 py-3 text-right text-gray-300 text-sm">—</td>}
                      <td className="px-4 py-3 text-right text-gray-300 text-sm">—</td>
                    </tr>
                  );
                })}
                </>
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
            <div className="flex items-center gap-3">
              <div className="flex gap-1">
                {RANK_TYPES.map((rt) => (
                  <button key={rt.value} onClick={() => setRankType(rt.value)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${rankType === rt.value ? 'bg-brand-500 text-white' : 'text-gray-500 hover:text-gray-900 hover:bg-gray-100'}`}>
                    {rt.label}
                  </button>
                ))}
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
                  tickFormatter={(v: string) => {
                    if (!v) return '';
                    const d = new Date(v);
                    return (trendRange === 0 || trendRange > 60)
                      ? d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
                      : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                  }} />
                <YAxis domain={[yMax, yMin]} reversed tick={{ fontSize: 11, fill: '#9ca3af' }} width={28} />
                <Tooltip formatter={(value: number) => [`Rank ${value}`, 'Rank']}
                  labelFormatter={(label: string) => label ? new Date(label).toLocaleDateString() : ''} />
                <Line type="monotone" dataKey="rank" stroke="#0052CC" strokeWidth={2} dot={{ r: 3, fill: '#0052CC' }} activeDot={{ r: 5 }} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      )}
      </>)}
    </div>
  );
}
