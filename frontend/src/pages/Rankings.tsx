import { useState, useEffect, useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import useSWR from 'swr';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { MapContainer, CircleMarker, Popup, TileLayer } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { useClient } from '../hooks/useClient';
import { BarChart2, MapPin, Search } from 'lucide-react';
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
  searchEngine: string;
  geoLocation: string | null;
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

const ENGINE_LABELS: Record<string, string> = {
  'google': 'Google',
  'google-local-finder': 'Google - Local',
  'google-mobile': 'Google Mobile',
  'bing': 'Bing',
  'bing-local': 'Bing Local',
};

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
    return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-500">—</span>;
  }
  const improved = delta > 0;
  return (
    <span className={`inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-xs font-medium ${improved ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>
      {improved ? '▲' : '▼'} {Math.abs(delta)}
    </span>
  );
}

function SortIcon({ active, dir }: { active: boolean; dir: 'asc' | 'desc' }) {
  if (!active) return <span className="text-slate-300 ml-1">↕</span>;
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

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 2) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

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
        <button onClick={() => setEditing(false)} className="text-xs text-slate-400">✕</button>
      </div>
    );
  }

  return (
    <button onClick={startEdit} className="text-sm text-slate-500 hover:text-brand-500 hover:underline tabular-nums" title="Click to set monthly search volume">
      {value != null ? value.toLocaleString() : <span className="text-slate-300">set vol.</span>}
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
    <div className="bg-white rounded-xl shadow-card p-5">
      <h2 className="text-sm font-semibold text-slate-900 mb-1">ROI Settings</h2>
      <p className="text-xs text-slate-500 mb-4">Used to estimate the monthly revenue value of your keyword rankings.</p>
      <div className="flex flex-wrap gap-4 items-end">
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Avg. customer value ($)</label>
          <input
            type="number"
            min={0}
            value={acv}
            onChange={(e) => setAcv(e.target.value)}
            placeholder="e.g. 350"
            className="w-32 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Conversion rate (%)</label>
          <input
            type="number"
            min={0}
            max={100}
            step={0.1}
            value={conv}
            onChange={(e) => setConv(e.target.value)}
            placeholder="2.5"
            className="w-28 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
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
          {saved && <span className="text-xs text-emerald-600 font-medium">Saved!</span>}
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

  // Synchronous in-flight guard: setAdding() is async, so two clicks in the same tick
  // both read adding===false and double-POST. This blocks the second fire immediately.
  const addingRef = useRef(false);
  const handleAdd = async () => {
    const kw = newKeyword.trim();
    if (!kw || !activeLocationId || addingRef.current) return;
    addingRef.current = true;
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
      addingRef.current = false;
    }
  };

  const handleDelete = async (id: string) => {
    await apiFetch(`/keywords/${id}`, { method: 'DELETE' }, true);
    await mutateKw();
    onChanged();
  };

  return (
    <div className="bg-white rounded-xl shadow-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Manage Keywords</h2>
          <p className="text-xs text-slate-500 mt-0.5">Keywords are tracked per location. New keywords appear in the table below after the next scheduled scan.</p>
        </div>
        <select
          value={activeLocationId}
          onChange={(e) => setActiveLocationId(e.target.value)}
          className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-500 min-w-[180px]"
        >
          {locations.map((l) => (
            <option key={l.id} value={l.id}>{[l.name, l.city, l.state].filter(Boolean).join(', ')}</option>
          ))}
        </select>
      </div>
      {locations.length === 0 ? (
        <p className="text-sm text-slate-500">
          You don't have a location yet, and keywords are tracked per location.{' '}
          <Link to="/dashboard/settings?tab=locations" className="font-medium text-brand-600 underline hover:text-brand-700">
            Add a location in Settings
          </Link>{' '}
          to start adding keywords.
        </p>
      ) : !activeLocationId ? (
        <p className="text-sm text-slate-400">Select a location to manage its keywords.</p>
      ) : (
        <div className="space-y-2">
          {keywords.length > 0 && (
            <div className="divide-y divide-slate-100 rounded-lg border border-slate-100 overflow-hidden">
              {keywords.map((kw) => (
                <div key={kw.id} className="flex items-center justify-between px-3 py-2 bg-slate-50">
                  <span className="text-sm text-slate-800">{kw.keyword}</span>
                  <button onClick={() => void handleDelete(kw.id)} className="text-red-400 hover:text-red-600 text-xs font-medium ml-4">Remove</button>
                </div>
              ))}
            </div>
          )}
          {keywords.length === 0 && <p className="text-sm text-slate-400">No keywords yet for this location.</p>}
          {addError && <p className="text-xs text-red-500">{addError}</p>}
          <div className="flex gap-2">
            <input
              type="text"
              value={newKeyword}
              onChange={(e) => { setNewKeyword(e.target.value); setAddError(null); }}
              onKeyDown={(e) => { if (e.key === 'Enter') void handleAdd(); }}
              placeholder="e.g. plumber near me"
              className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
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
      }) as { success?: boolean; data?: { report?: GeoReport }; error?: { message?: string } };
      if (!res.success) {
        setTriggerError(res.error?.message ?? 'Failed to start scan');
        return;
      }
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
          <label className="block text-xs text-slate-500 mb-1">Location</label>
          <select value={selectedLocationId} onChange={(e) => setSelectedLocationId(e.target.value)}
            className="text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500">
            <option value="">Select location…</option>
            {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs text-slate-500 mb-1">Keyword</label>
          <select value={selectedKeywordId} onChange={(e) => setSelectedKeywordId(e.target.value)}
            className="text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500">
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
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <div className="h-4 w-4 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
          Generating visibility map… (can take up to 10 minutes)
        </div>
      )}

      {latestReport?.status === 'complete' && latestReport.gridData && (
        <>
          <div className="h-96 rounded-xl overflow-hidden border border-slate-200">
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
                  <div key={s.label} className="bg-white rounded-xl shadow-card p-4 text-center">
                    <p className="text-xs text-slate-500 mb-1">{s.label}</p>
                    <p className="text-xl font-bold text-slate-900">{s.value}</p>
                  </div>
                ))}
              </div>
            );
          })()}
        </>
      )}

      {(!selectedLocationId || !selectedKeywordId) && (
        <div className="py-12 text-center text-slate-400 text-sm">Select a location and keyword above, then click "Run Scan" to generate a visibility map.</div>
      )}

      {!latestReport && selectedLocationId && selectedKeywordId && (
        <div className="py-12 text-center text-slate-400 text-sm">No scan yet. Click "Run Scan" to generate a visibility map.</div>
      )}

      <div className="flex gap-4 text-xs text-slate-500 flex-wrap">
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
  const { isLite, client, loading: planLoading, mutate: mutateClient } = useClient();
  // Lite gets a single manual scan so a new client isn't stuck waiting for the nightly
  // job; once spent, the button goes away and only the nightly scan applies.
  const liteScanAvailable = isLite && client?.manualScanUsed === false;
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
  const [search, setSearch] = useState('');

  const rankingsUrl = rankType !== 'all' ? `/rankings?rankType=${rankType}` : '/rankings';
  const { data: rankingsData, isLoading, error, mutate: mutateRankings } = useSWR<{ success: boolean; data: RankingRow[] }>(rankingsUrl, fetcher);
  // ROI is a Pro feature (backend gates /analytics/roi) — don't fetch it for Lite.
  // Wait for the plan to load so a Lite user doesn't fire a transient 403.
  const { data: roiData, mutate: roiMutate } = useSWR<{ success: boolean; data: RoiData }>(planLoading || isLite ? null : '/analytics/roi', fetcher);
  const { data: allKwData, mutate: mutateAllKw } = useSWR<KeywordsListResponse>('/keywords', fetcher);
  const { data: locData, isLoading: locLoading } = useSWR<LocationsResponse>('/locations', fetcher);

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
    const av = a[sortKey];
    const bv = b[sortKey];
    // Nulls always sort last regardless of direction
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    const cmp = typeof av === 'number' && typeof bv === 'number'
      ? av - bv
      : String(av).localeCompare(String(bv));
    return sortDir === 'asc' ? cmp : -cmp;
  });

  const filtered = search
    ? sorted.filter((r) => r.keyword.toLowerCase().includes(search.toLowerCase()))
    : sorted;

  const rankedRows = rows.filter((r) => r.rank != null);
  const avgRank = rankedRows.length > 0
    ? rankedRows.reduce((sum, r) => sum + (r.rank as number), 0) / rankedRows.length
    : null;

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('asc'); }
  };

  const handleSync = async () => {
    setSyncing(true);
    setSyncMessage(null);
    try {
      const res = await apiFetch<{ success: boolean; data?: { message?: string }; error?: { message: string } }>('/rankings/sync', { method: 'POST' });
      const isOk = (res as { success: boolean }).success;
      const msg = (res as { data?: { message?: string } }).data?.message
        ?? (res as { error?: { message: string } }).error?.message
        ?? (isOk ? 'Refresh complete.' : 'Refresh failed.');
      setSyncMessage({ text: msg, ok: isOk });
      if (isOk) {
        await mutateRankings();
        await mutateAllKw();
        // Lite's single scan may now be spent — refetch so the button reflects that.
        if (isLite) mutateClient();
      }
    } catch (e) {
      setSyncMessage({ text: (e as Error).message ?? 'Refresh failed.', ok: false });
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

  // Keywords are tracked per location, so with no location there is nowhere to attach
  // one — the Keywords panel's location picker is empty and the add flow is a dead end.
  const hasNoLocations = !locLoading && (locData?.data?.length ?? 0) === 0;

  return (
    <div className="space-y-6">
      {hasNoLocations && (
        <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
          <MapPin className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
          <div className="text-sm">
            <p className="font-medium text-amber-900">Add a location to start tracking keywords</p>
            <p className="text-amber-700 mt-0.5">
              Keywords are tracked per location, so you'll need one before you can add any.{' '}
              <Link to="/dashboard/settings?tab=locations" className="font-medium underline hover:text-amber-900">
                Add your first location
              </Link>{' '}
              in Settings, then come back here to add keywords.
            </p>
          </div>
        </div>
      )}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-slate-900 tracking-tight">Rankings</h1>
        <div className="flex gap-1 sm:gap-2">
          {(!isLite || liteScanAvailable) && (
            <button
              onClick={() => void handleSync()}
              disabled={syncing}
              title={liteScanAvailable
                ? 'Run your one-time scan now instead of waiting for tonight. Rankings update automatically every night after that.'
                : undefined}
              className="whitespace-nowrap px-1.5 py-1 text-xs sm:px-4 sm:py-2 sm:text-sm font-medium text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-50 transition-colors"
            >
              {syncing ? 'Scanning…' : liteScanAvailable ? 'Scan now' : 'Refresh'}
            </button>
          )}
          <button
            onClick={() => setShowKeywords((v) => !v)}
            className={`whitespace-nowrap px-1.5 py-1 text-xs sm:px-4 sm:py-2 sm:text-sm font-medium rounded-lg border transition-colors ${showKeywords ? 'bg-brand-500 text-white border-brand-500' : 'text-slate-600 border-slate-200 hover:bg-slate-50'}`}
          >
            Keywords
          </button>
          {!isLite && (
            <button
              onClick={() => setShowRoi((v) => !v)}
              className={`whitespace-nowrap px-1.5 py-1 text-xs sm:px-4 sm:py-2 sm:text-sm font-medium rounded-lg border transition-colors ${showRoi ? 'bg-brand-500 text-white border-brand-500' : 'text-slate-600 border-slate-200 hover:bg-slate-50'}`}
            >
              ROI
            </button>
          )}
          {!isLite && (
            <button
              onClick={async () => {
                const res = await apiFetch<never>('/analytics/export?type=rankings', {}, true);
                const blob = await res.blob();
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = 'rankings-export.csv';
                a.click();
                URL.revokeObjectURL(url);
              }}
              className="whitespace-nowrap px-1.5 py-1 text-xs sm:px-4 sm:py-2 sm:text-sm font-medium text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
            >
              Export CSV
            </button>
          )}
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
            <div key={card.label} className="bg-white rounded-xl shadow-card p-5">
              <p className="text-xs text-slate-500 mb-1">{card.label}</p>
              <p className="text-2xl font-bold text-slate-900">{card.value}</p>
            </div>
          ))}
        </div>
      )}

      {rows.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { label: 'AVG RANK', value: avgRank != null ? avgRank.toFixed(1) : '—' },
            { label: 'KEYWORDS TRACKED', value: String(new Set(rows.map((r) => r.keywordId)).size + pendingKeywords.length) },
            { label: 'IN TOP 3', value: String(rows.filter((r) => r.rank != null && r.rank <= 3).length) },
            { label: 'GAINS THIS SCAN', value: String(rows.filter((r) => r.delta != null && r.delta > 0).length) },
          ].map((c) => (
            <div key={c.label} className="bg-white rounded-xl shadow-card p-5">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-2">{c.label}</p>
              <p className="text-3xl font-bold text-slate-900 tracking-tight">{c.value}</p>
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
      <div className="flex gap-1 border-b border-slate-200">
        <button onClick={() => setMainTab('table')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${mainTab === 'table' ? 'border-brand-500 text-brand-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
          <span className="flex items-center gap-1.5">
            <BarChart2 size={14} />
            Rankings Table
          </span>
        </button>
        {/* Visibility Map (geo-grid) is Pro-only */}
        {!isLite && (
          <button onClick={() => setMainTab('map')}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${mainTab === 'map' ? 'border-brand-500 text-brand-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
            <span className="flex items-center gap-1.5">
              📍 Visibility Map
            </span>
          </button>
        )}
      </div>

      {mainTab === 'map' && (
        <GeoGridPanel />
      )}

      {mainTab === 'table' && (<>
      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-xs">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search keywords…"
            className="w-full pl-8 pr-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>
      </div>
      <div className="bg-white rounded-xl shadow-card overflow-hidden overflow-x-auto">
        {isLoading ? (
          <div className="p-8 text-center text-sm text-slate-400">Loading rankings...</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50/70 border-b border-slate-100">
                {(['keyword', 'location', 'rank', 'delta', 'pulledAt'] as SortKey[]).map((key) => {
                  const labels: Record<SortKey, string> = { keyword: 'Keyword', location: 'Location', rank: 'Rank', delta: 'Change', pulledAt: 'Updated' };
                  const right = ['rank', 'delta'].includes(key);
                  const hideMobile = ['location', 'pulledAt'].includes(key);
                  return (
                    <th key={key} onClick={() => handleSort(key)} className={`${hideMobile ? 'hidden sm:table-cell' : ''} px-6 py-3 text-xs font-semibold text-slate-500 uppercase tracking-widest cursor-pointer hover:text-slate-900 select-none ${right ? 'text-right' : 'text-left'}`}>
                      {labels[key]}<SortIcon active={sortKey === key} dir={sortDir} />
                    </th>
                  );
                })}
                <th className="hidden sm:table-cell px-6 py-3 text-xs font-semibold text-slate-500 uppercase tracking-widest text-left">Engine</th>
                {showRoi && (
                  <th className="hidden sm:table-cell px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-widest text-right">Search Vol.</th>
                )}
                <th className="hidden sm:table-cell px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-widest text-right">
                  <span className="flex items-center justify-end gap-1">
                    Est. Revenue / mo
                    <span title="Based on your ROI settings" className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full bg-slate-200 text-slate-500 text-[10px] font-bold cursor-help leading-none">i</span>
                  </span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.length === 0 && pendingKeywords.length === 0 ? (
                <tr>
                  <td colSpan={showRoi ? 8 : 7} className="px-6 py-10 text-center text-slate-400">
                    No keywords yet. Click <strong>Keywords</strong> above to add some.
                  </td>
                </tr>
              ) : (
                <>
                {filtered.map((row) => {
                  const roi = roiByKeyword[row.keywordId];
                  const localVol = row.keywordId in localVolumes ? localVolumes[row.keywordId] : roi?.monthlySearchVolume ?? null;
                  return (
                    <tr
                      key={`${row.keywordId}-${row.searchEngine}-${row.geoLocation ?? 'primary'}`}
                      onClick={() => setSelectedRow(row)}
                      className={`cursor-pointer transition-colors ${effectiveSelected?.keywordId === row.keywordId && effectiveSelected?.searchEngine === row.searchEngine && effectiveSelected?.geoLocation === row.geoLocation ? 'bg-brand-50' : 'hover:bg-slate-50/80'}`}
                    >
                      <td className="px-6 py-3 font-medium text-slate-900">
                        {row.keyword}
                        {row.geoLocation && (
                          <span className="ml-2 text-xs font-normal text-slate-400">{row.geoLocation.split(',')[0]}</span>
                        )}
                      </td>
                      <td className="hidden sm:table-cell px-6 py-3 text-slate-500">{row.location ?? '—'}</td>
                      <td className="px-6 py-3 text-right font-semibold text-slate-900">{row.rank}</td>
                      <td className="px-6 py-3 text-right">
                        {row.delta != null ? <DeltaBadge delta={row.delta} /> : <span className="text-slate-400 text-sm">—</span>}
                      </td>
                      <td className="hidden sm:table-cell px-6 py-3 text-slate-500">
                        {row.pulledAt ? timeAgo(row.pulledAt) : '—'}
                      </td>
                      <td className="hidden sm:table-cell px-6 py-3 text-slate-500">
                        {ENGINE_LABELS[row.searchEngine] ?? row.searchEngine}
                      </td>
                      {showRoi && (
                        <td className="hidden sm:table-cell px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
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
                      <td className="hidden sm:table-cell px-4 py-3 text-right font-medium text-slate-700 tabular-nums">
                        {roiConfigured
                          ? (roi?.estRevenue != null ? fmt$(roi.estRevenue) : <span className="text-slate-300 text-xs">—</span>)
                          : <span className="text-slate-300 text-xs">—</span>
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
                      <td className="px-6 py-3 font-medium text-slate-700">{pk.keyword}</td>
                      <td className="hidden sm:table-cell px-6 py-3 text-slate-500">{locName}</td>
                      <td className="px-6 py-3 text-right">
                        <span
                          title={isLite
                            ? 'Rankings are scanned automatically every night. This keyword will have results after the next scan.'
                            : 'Rankings are scanned automatically every night. This keyword will have results after the next scan — or click Refresh to scan now.'}
                          className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-500 cursor-help"
                        >
                          Awaiting scan
                        </span>
                      </td>
                      <td className="px-6 py-3 text-right text-slate-300 text-sm">—</td>
                      <td className="hidden sm:table-cell px-6 py-3 text-slate-300 text-sm">—</td>
                      {showRoi && <td className="hidden sm:table-cell px-4 py-3 text-right text-slate-300 text-sm">—</td>}
                      <td className="hidden sm:table-cell px-4 py-3 text-right text-slate-300 text-sm">—</td>
                    </tr>
                  );
                })}
                </>
              )}
            </tbody>
          </table>
        )}
        {pendingKeywords.length > 0 && (
          <p className="px-6 py-3 text-xs text-slate-500 border-t border-slate-100">
            {pendingKeywords.length === 1 ? '1 keyword is' : `${pendingKeywords.length} keywords are`} awaiting their first scan.
            Rankings are scanned automatically every night, so results appear within 24 hours — no action needed
            {liteScanAvailable
              ? ", or use your one-time Scan now to see results immediately."
              : isLite ? '.' : ', or click Refresh to scan now.'}
          </p>
        )}
      </div>

      {/* Trend chart */}
      {effectiveSelected && (
        <div className="bg-white rounded-xl shadow-card p-6">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h2 className="text-base font-semibold text-slate-900">Rank Trend — {effectiveSelected.keyword}</h2>
              <p className="text-xs text-slate-500 mt-0.5">{effectiveSelected.location}</p>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex gap-1">
                {RANK_TYPES.map((rt) => (
                  <button key={rt.value} onClick={() => setRankType(rt.value)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${rankType === rt.value ? 'bg-brand-500 text-white' : 'text-slate-500 hover:text-slate-900 hover:bg-slate-100'}`}>
                    {rt.label}
                  </button>
                ))}
              </div>
              <div className="flex gap-1">
                {TREND_RANGES.map((r) => (
                  <button key={r.value} onClick={() => setTrendRange(r.value)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${trendRange === r.value ? 'bg-brand-500 text-white' : 'text-slate-500 hover:text-slate-900 hover:bg-slate-100'}`}>
                    {r.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
          {trendLoading ? (
            <div className="h-48 flex items-center justify-center text-sm text-slate-400">Loading trend...</div>
          ) : trendPoints.length === 0 ? (
            <div className="h-48 flex items-center justify-center text-sm text-slate-400">No trend data available for this period.</div>
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
