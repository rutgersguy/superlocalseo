import { useState } from 'react';
import useSWR, { mutate } from 'swr';
import { Plus, RefreshCw, Trash2, Star, MessageSquare, ExternalLink, Search, AlertCircle, X, TrendingDown, TrendingUp, Minus, Target } from 'lucide-react';
import { fetcher, apiFetch } from '../services/api';

interface Competitor {
  id: string;
  name: string;
  website: string | null;
  googlePlaceId: string | null;
  googleRating: number | null;
  googleReviewCount: number | null;
  lastSyncedAt: string | null;
}

interface PlatformStat {
  platform: string;
  avgRating: number;
  count: number;
}

interface ClientStats {
  avgRating: number | null;
  reviewCount: number;
  byPlatform: PlatformStat[];
}

interface CompetitorsResponse {
  success: boolean;
  data: { competitors: Competitor[]; clientStats: ClientStats };
}

interface GapKeyword {
  keyword: string;
  location: string;
  yourRank: number | null;
  status: 'winning' | 'competing' | 'vulnerable' | 'absent';
  lastChecked: string;
}

interface GapCompetitor {
  id: string;
  name: string;
  website: string | null;
  googleRating: number | null;
  googleReviewCount: number | null;
}

interface GapResponse {
  success: boolean;
  data: { keywords: GapKeyword[]; opportunities: number; competitors: GapCompetitor[] };
}

interface PlaceResult {
  placeId: string;
  name: string;
  address: string | null;
  rating: number | null;
  reviewCount: number | null;
}

function StarRating({ rating }: { rating: number | null }) {
  if (rating === null) return <span className="text-slate-400 text-sm">—</span>;
  return (
    <span className="flex items-center gap-1">
      <Star size={14} className="fill-yellow-400 text-yellow-400" />
      <span className="font-semibold text-slate-800">{rating.toFixed(1)}</span>
    </span>
  );
}

function RatingBar({ value, max = 5 }: { value: number | null; max?: number }) {
  if (value === null) return <div className="h-2 bg-slate-100 rounded-full w-full" />;
  const pct = (value / max) * 100;
  const color = value >= 4.5 ? 'bg-green-500' : value >= 4 ? 'bg-yellow-400' : value >= 3 ? 'bg-orange-400' : 'bg-red-400';
  return (
    <div className="h-2 bg-slate-100 rounded-full w-full overflow-hidden">
      <div className={`h-2 rounded-full ${color} transition-all duration-500`} style={{ width: `${pct}%` }} />
    </div>
  );
}

function AddCompetitorModal({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const [name, setName] = useState('');
  const [website, setWebsite] = useState('');
  const [placeId, setPlaceId] = useState('');
  const [searchQ, setSearchQ] = useState('');
  const [searchResults, setSearchResults] = useState<PlaceResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSearch() {
    if (!searchQ.trim()) return;
    setSearching(true);
    try {
      const res = await apiFetch<{ success: boolean; data: { results: PlaceResult[] } }>(
        `/competitors/search?q=${encodeURIComponent(searchQ)}`,
      );
      setSearchResults(res.data?.results ?? []);
    } catch {
      // silent
    } finally {
      setSearching(false);
    }
  }

  function selectPlace(r: PlaceResult) {
    if (!name) setName(r.name);
    setPlaceId(r.placeId);
    setSearchResults([]);
    setSearchQ('');
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const res = await apiFetch<{ success: boolean; error?: { message: string } }>(
        '/competitors',
        {
          method: 'POST',
          body: JSON.stringify({
            name: name.trim(),
            website: website.trim() || undefined,
            googlePlaceId: placeId.trim() || undefined,
          }),
        },
      );
      if (!res.success) {
        setError((res as { error?: { message: string } }).error?.message ?? 'Failed to add competitor');
        return;
      }
      onAdded();
      onClose();
    } catch {
      setError('Network error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <h2 className="font-semibold text-slate-900">Add competitor</h2>
          <button onClick={onClose} className="p-1 rounded text-slate-400 hover:text-slate-600"><X size={18} /></button>
        </div>
        <form onSubmit={(e) => void handleSubmit(e)} className="p-5 space-y-4">
          {/* Google Places search */}
          <div>
            <label className="block text-xs text-slate-500 mb-1">Search Google Places (optional)</label>
            <div className="flex gap-2">
              <input
                value={searchQ}
                onChange={(e) => setSearchQ(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void handleSearch(); } }}
                placeholder="Search by business name…"
                className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
              <button
                type="button"
                onClick={() => void handleSearch()}
                disabled={searching}
                className="px-3 py-2 bg-slate-100 rounded-lg text-sm hover:bg-slate-200 disabled:opacity-50 transition-colors"
              >
                <Search size={14} />
              </button>
            </div>
            {searchResults.length > 0 && (
              <div className="mt-1 border border-slate-200 rounded-lg overflow-hidden shadow-card">
                {searchResults.map((r) => (
                  <button
                    key={r.placeId}
                    type="button"
                    onClick={() => selectPlace(r)}
                    className="w-full text-left px-3 py-2.5 hover:bg-slate-50 border-b border-slate-100 last:border-0 transition-colors"
                  >
                    <div className="font-medium text-sm text-slate-800">{r.name}</div>
                    <div className="text-xs text-slate-400 mt-0.5">{r.address ?? ''}
                      {r.rating != null && <span className="ml-2">⭐ {r.rating} ({r.reviewCount?.toLocaleString()})</span>}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div>
            <label className="block text-xs text-slate-500 mb-1">Competitor name *</label>
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Acme Plumbing Co."
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">Website</label>
            <input
              type="url"
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
              placeholder="https://acmeplumbing.com"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">Google Place ID</label>
            <input
              value={placeId}
              onChange={(e) => setPlaceId(e.target.value)}
              placeholder="ChIJ… (auto-filled when you pick from search)"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
            <p className="text-xs text-slate-400 mt-1">
              Needed to pull their Google rating automatically. Search above or{' '}
              <a
                href="https://developers.google.com/maps/documentation/javascript/examples/places-placeid-finder"
                target="_blank"
                rel="noopener noreferrer"
                className="text-brand-500 hover:underline"
              >
                find it here
              </a>.
            </p>
          </div>

          {error && (
            <div className="flex items-center gap-2 text-red-600 text-sm">
              <AlertCircle size={14} /> {error}
            </div>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-slate-600 hover:text-slate-900">Cancel</button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 bg-brand-500 text-white text-sm font-medium rounded-lg hover:bg-brand-600 disabled:opacity-50 transition-colors"
            >
              {saving ? 'Adding…' : 'Add competitor'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function CompetitorRow({ c, onDelete, onSync }: { c: Competitor; onDelete: () => void; onSync: () => void }) {
  const [syncing, setSyncing] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function handleSync() {
    setSyncing(true);
    try {
      await apiFetch(`/competitors/${c.id}/sync`, { method: 'POST' });
      onSync();
    } catch { /* ignore */ }
    finally { setSyncing(false); }
  }

  async function handleDelete() {
    if (!confirm(`Remove ${c.name}?`)) return;
    setDeleting(true);
    try {
      await apiFetch(`/competitors/${c.id}`, { method: 'DELETE' });
      onDelete();
    } catch { /* ignore */ }
    finally { setDeleting(false); }
  }

  return (
    <div className="flex items-center gap-4 px-5 py-4">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-slate-800 truncate">{c.name}</span>
          {c.website && (
            <a href={c.website} target="_blank" rel="noopener noreferrer" className="text-slate-400 hover:text-brand-500">
              <ExternalLink size={12} />
            </a>
          )}
        </div>
        {c.lastSyncedAt && (
          <p className="text-xs text-slate-400 mt-0.5">
            Synced {new Date(c.lastSyncedAt).toLocaleDateString()}
          </p>
        )}
      </div>

      <div className="w-28 text-center">
        <StarRating rating={c.googleRating} />
        {c.googleReviewCount != null && (
          <p className="text-xs text-slate-400 mt-0.5">{c.googleReviewCount.toLocaleString()} reviews</p>
        )}
      </div>

      <div className="w-32">
        <RatingBar value={c.googleRating} />
      </div>

      <div className="flex items-center gap-1">
        {c.googlePlaceId && (
          <button
            onClick={() => void handleSync()}
            disabled={syncing}
            title="Refresh from Google"
            className="p-1.5 rounded-lg text-slate-400 hover:text-brand-500 hover:bg-slate-100 disabled:opacity-50 transition-colors"
          >
            <RefreshCw size={14} className={syncing ? 'animate-spin' : ''} />
          </button>
        )}
        <button
          onClick={() => void handleDelete()}
          disabled={deleting}
          title="Remove"
          className="p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 disabled:opacity-50 transition-colors"
        >
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );
}

const STATUS_CONFIG = {
  winning:    { label: 'Top 3',      color: 'text-green-700 bg-green-50',  icon: TrendingUp },
  competing:  { label: 'Top 10',     color: 'text-blue-700 bg-blue-50',    icon: Minus },
  vulnerable: { label: 'Rank 11+',   color: 'text-amber-700 bg-amber-50',  icon: TrendingDown },
  absent:     { label: 'Not ranked', color: 'text-red-700 bg-red-50',      icon: TrendingDown },
};

function GapReport() {
  const { data, isLoading } = useSWR<GapResponse>('/competitors/gap', fetcher);
  const [filter, setFilter] = useState<'all' | 'opportunities'>('all');

  const gapData = data?.data;
  const keywords = gapData?.keywords ?? [];
  const visible = filter === 'opportunities'
    ? keywords.filter((k) => k.status === 'vulnerable' || k.status === 'absent')
    : keywords;

  if (isLoading) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl shadow-card p-6">
        <div className="h-4 bg-slate-200 rounded animate-pulse w-40 mb-4" />
        <div className="space-y-2">
          {[1, 2, 3].map((n) => <div key={n} className="h-10 bg-slate-100 rounded animate-pulse" />)}
        </div>
      </div>
    );
  }

  if (!gapData || keywords.length === 0) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl shadow-card p-6 text-center">
        <Target size={32} className="mx-auto text-slate-300 mb-3" />
        <h3 className="font-semibold text-slate-700 mb-1">No ranking data yet</h3>
        <p className="text-sm text-slate-400">Connect your integrations to start tracking keyword rankings and see gap opportunities.</p>
      </div>
    );
  }

  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-card overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between flex-wrap gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Keyword Gap Report</h3>
          <p className="text-xs text-slate-500 mt-0.5">
            {gapData.opportunities > 0
              ? `${gapData.opportunities} keyword${gapData.opportunities !== 1 ? 's' : ''} need attention`
              : 'All tracked keywords are in the top 10'}
          </p>
        </div>
        <div className="flex rounded-lg border border-slate-200 overflow-hidden text-xs font-medium">
          <button
            onClick={() => setFilter('all')}
            className={`px-3 py-1.5 transition-colors ${filter === 'all' ? 'bg-brand-500 text-white' : 'text-slate-600 hover:bg-slate-50'}`}
          >
            All ({keywords.length})
          </button>
          <button
            onClick={() => setFilter('opportunities')}
            className={`px-3 py-1.5 transition-colors ${filter === 'opportunities' ? 'bg-brand-500 text-white' : 'text-slate-600 hover:bg-slate-50'}`}
          >
            Opportunities ({gapData.opportunities})
          </button>
        </div>
      </div>

      {visible.length === 0 ? (
        <div className="py-8 text-center text-sm text-slate-400">No keywords match this filter.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs font-semibold text-slate-400 uppercase tracking-wide bg-slate-50">
                <th className="text-left px-5 py-2.5">Keyword</th>
                <th className="text-left px-3 py-2.5">Location</th>
                <th className="text-center px-3 py-2.5">Your rank</th>
                <th className="text-left px-3 py-2.5">Status</th>
                <th className="text-left px-3 py-2.5">Last checked</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {visible.map((k, i) => {
                const cfg = STATUS_CONFIG[k.status];
                const Icon = cfg.icon;
                return (
                  <tr key={i} className="hover:bg-slate-50 transition-colors">
                    <td className="px-5 py-3 font-medium text-slate-800">{k.keyword}</td>
                    <td className="px-3 py-3 text-slate-500 text-xs">{k.location}</td>
                    <td className="px-3 py-3 text-center">
                      {k.yourRank !== null
                        ? <span className="font-bold text-slate-800">#{k.yourRank}</span>
                        : <span className="text-slate-400">—</span>}
                    </td>
                    <td className="px-3 py-3">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${cfg.color}`}>
                        <Icon size={11} />
                        {cfg.label}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-xs text-slate-400">
                      {new Date(k.lastChecked).toLocaleDateString()}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function Competitors() {
  const [showAdd, setShowAdd] = useState(false);
  const { data, isLoading, error } = useSWR<CompetitorsResponse>('/competitors', fetcher);

  const competitors = data?.data?.competitors ?? [];
  const stats = data?.data?.clientStats;

  function refresh() { void mutate('/competitors'); }

  if (error) {
    return (
      <div className="flex items-center gap-2 text-red-600 text-sm mt-8 justify-center">
        <AlertCircle size={16} /> Failed to load competitors
      </div>
    );
  }

  const googleStat = stats?.byPlatform.find((p) => p.platform.toLowerCase() === 'google');

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Competitor Benchmarking</h1>
          <p className="text-sm text-slate-500 mt-1">Track how your Google rating and review count compares to local competitors.</p>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="flex items-center gap-2 px-4 py-2 bg-brand-500 text-white text-sm font-medium rounded-lg hover:bg-brand-600 transition-colors"
        >
          <Plus size={15} /> Add competitor
        </button>
      </div>

      {/* Your business card */}
      {stats && (
        <div className="bg-brand-50 border border-brand-100 rounded-xl px-5 py-4">
          <p className="text-xs font-semibold text-brand-600 uppercase tracking-wide mb-3">Your business</p>
          <div className="flex items-center gap-6 flex-wrap">
            <div>
              <div className="flex items-center gap-1.5">
                <Star size={16} className="fill-yellow-400 text-yellow-400" />
                <span className="text-2xl font-bold text-slate-900">
                  {stats.avgRating != null ? stats.avgRating.toFixed(1) : '—'}
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">Avg rating (all platforms)</p>
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <MessageSquare size={16} className="text-brand-500" />
                <span className="text-2xl font-bold text-slate-900">{stats.reviewCount.toLocaleString()}</span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">Total reviews</p>
            </div>
            {googleStat && (
              <div>
                <div className="flex items-center gap-1.5">
                  <Star size={16} className="fill-yellow-400 text-yellow-400" />
                  <span className="text-2xl font-bold text-slate-900">{googleStat.avgRating.toFixed(1)}</span>
                </div>
                <p className="text-xs text-slate-500 mt-0.5">Google rating ({googleStat.count.toLocaleString()} reviews)</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Comparison table */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-card overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100 bg-slate-50">
          <div className="flex items-center gap-4 text-xs font-semibold text-slate-400 uppercase tracking-wide">
            <span className="flex-1">Competitor</span>
            <span className="w-28 text-center">Google rating</span>
            <span className="w-32">Rating bar</span>
            <span className="w-16 text-center">Actions</span>
          </div>
        </div>

        {isLoading && (
          <div className="space-y-0 divide-y divide-slate-100">
            {[1, 2, 3].map((n) => (
              <div key={n} className="h-16 animate-pulse bg-slate-50" />
            ))}
          </div>
        )}

        {!isLoading && competitors.length === 0 && (
          <div className="py-12 text-center">
            <Search size={32} className="mx-auto text-slate-300 mb-3" />
            <h3 className="font-semibold text-slate-700 mb-1">No competitors yet</h3>
            <p className="text-sm text-slate-400">Add a competitor to start benchmarking your Google rating and review volume.</p>
          </div>
        )}

        {competitors.length > 0 && (
          <div className="divide-y divide-slate-100">
            {competitors.map((c) => (
              <CompetitorRow key={c.id} c={c} onDelete={refresh} onSync={refresh} />
            ))}
          </div>
        )}
      </div>

      {/* Google rating leaderboard */}
      {competitors.length > 0 && stats && (
        <div className="bg-white border border-slate-200 rounded-xl shadow-card p-5">
          <h3 className="text-sm font-semibold text-slate-700 mb-4">Google rating comparison</h3>
          <div className="space-y-3">
            {[
              { name: 'You', rating: googleStat?.avgRating ?? null, count: googleStat?.count ?? null, isYou: true },
              ...competitors.map((c) => ({ name: c.name, rating: c.googleRating, count: c.googleReviewCount, isYou: false })),
            ]
              .filter((e) => e.rating !== null)
              .sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0))
              .map((entry, i) => (
                <div key={entry.name} className="flex items-center gap-3">
                  <span className={`w-5 text-xs font-bold ${i === 0 ? 'text-yellow-500' : 'text-slate-400'}`}>#{i + 1}</span>
                  <span className={`w-36 text-sm truncate ${entry.isYou ? 'font-semibold text-brand-600' : 'text-slate-700'}`}>{entry.name}</span>
                  <div className="flex-1">
                    <RatingBar value={entry.rating} />
                  </div>
                  <StarRating rating={entry.rating} />
                  {entry.count != null && <span className="text-xs text-slate-400 w-20 text-right">{entry.count.toLocaleString()} reviews</span>}
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Keyword gap report */}
      <GapReport />

      {showAdd && (
        <AddCompetitorModal onClose={() => setShowAdd(false)} onAdded={refresh} />
      )}
    </div>
  );
}
