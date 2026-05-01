import { useState } from 'react';
import useSWR from 'swr';
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer,
} from 'recharts';
import { apiFetch, fetcher } from '../services/api';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Review {
  id: string;
  authorName: string;
  rating: number;
  platform: string;
  reviewDate: string;
  body: string;
  status: 'new' | 'responded';
}

interface ReviewResponse {
  id: string;
  reviewId: string;
  draftBody: string;
  finalBody: string | null;
  status: 'draft' | 'approved';
  approvedAt: string | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function Stars({ rating }: { rating: number }) {
  return (
    <span className="text-yellow-400 text-sm">
      {'★'.repeat(Math.max(0, Math.min(5, rating)))}
      <span className="text-gray-300">{'★'.repeat(5 - Math.max(0, Math.min(5, rating)))}</span>
    </span>
  );
}

function PlatformBadge({ platform }: { platform: string }) {
  const colors: Record<string, string> = {
    Google: 'bg-blue-100 text-blue-700',
    Yelp: 'bg-red-100 text-red-600',
    Facebook: 'bg-indigo-100 text-indigo-700',
  };
  return <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${colors[platform] ?? 'bg-gray-100 text-gray-600'}`}>{platform}</span>;
}

function Avatar({ name }: { name: string }) {
  const initials = (name || '?').split(' ').slice(0, 2).map((s) => s[0] ?? '').join('').toUpperCase() || '?';
  return (
    <div className="w-9 h-9 rounded-full bg-brand-500 text-white text-sm font-semibold flex items-center justify-center flex-shrink-0">
      {initials}
    </div>
  );
}

const PLATFORM_COLORS: Record<string, string> = {
  Google: '#4285F4', Yelp: '#FF1A1A', Facebook: '#1877F2',
};
type TrendRange = 30 | 90 | 180;
const TREND_RANGES: { label: string; value: TrendRange }[] = [
  { label: '30d', value: 30 }, { label: '90d', value: 90 }, { label: '180d', value: 180 },
];

// ─── AI Response Panel ────────────────────────────────────────────────────────

function ResponsePanel({ reviewId, reviewBody }: { reviewId: string; reviewBody: string }) {
  const { data, mutate, isLoading } = useSWR<{ success: boolean; data: ReviewResponse | null }>(
    `/reviews/${reviewId}/response`, fetcher,
  );

  const [drafting, setDrafting] = useState(false);
  const [editText, setEditText] = useState('');
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);

  const response = data?.data;
  const displayText = editing ? editText : (response?.finalBody ?? response?.draftBody ?? '');

  const draftResponse = async () => {
    setDrafting(true);
    try {
      await apiFetch(`/reviews/${reviewId}/response/draft`, { method: 'POST' });
      await mutate();
      setEditing(false);
    } finally {
      setDrafting(false);
    }
  };

  const startEdit = () => {
    setEditText(response?.finalBody ?? response?.draftBody ?? '');
    setEditing(true);
  };

  const saveEdit = async () => {
    setSaving(true);
    try {
      await apiFetch(`/reviews/${reviewId}/response`, {
        method: 'PATCH',
        body: JSON.stringify({ body: editText }),
      });
      await mutate();
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  const approve = async () => {
    setSaving(true);
    try {
      const body: Record<string, unknown> = { approve: true };
      if (editing) body.body = editText;
      await apiFetch(`/reviews/${reviewId}/response`, { method: 'PATCH', body: JSON.stringify(body) });
      await mutate();
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  const copyText = async () => {
    const text = response?.finalBody ?? response?.draftBody ?? '';
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (isLoading) return <div className="mt-3 pt-3 border-t border-gray-100 text-xs text-gray-400">Loading response…</div>;

  if (!reviewBody) return (
    <div className="mt-3 pt-3 border-t border-gray-100 text-xs text-gray-400 italic">
      This review has no text — nothing to respond to.
    </div>
  );

  return (
    <div className="mt-3 pt-3 border-t border-gray-100">
      {!response ? (
        <button
          onClick={() => void draftResponse()}
          disabled={drafting}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-brand-600 border border-brand-200 rounded-lg hover:bg-brand-50 disabled:opacity-50"
        >
          {drafting ? (
            <><span className="w-3 h-3 border-2 border-brand-400 border-t-transparent rounded-full animate-spin inline-block" /> Drafting…</>
          ) : (
            <><span>✦</span> Draft AI response</>
          )}
        </button>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${response.status === 'approved' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
              {response.status === 'approved' ? 'Approved' : 'Draft'}
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => void draftResponse()}
                disabled={drafting}
                className="text-xs text-gray-400 hover:text-gray-600 disabled:opacity-50"
                title="Regenerate"
              >
                {drafting ? '…' : '↺ Regenerate'}
              </button>
            </div>
          </div>

          {editing ? (
            <textarea
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              rows={4}
              className="w-full border border-brand-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 resize-none"
            />
          ) : (
            <p className="text-sm text-gray-700 leading-relaxed bg-gray-50 rounded-lg px-3 py-2.5">{displayText}</p>
          )}

          <div className="flex gap-2 flex-wrap">
            {response.status !== 'approved' && !editing && (
              <button
                onClick={() => void approve()}
                disabled={saving}
                className="px-3 py-1.5 text-xs font-medium bg-brand-500 text-white rounded-lg hover:bg-brand-600 disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Approve'}
              </button>
            )}
            {editing ? (
              <>
                <button onClick={() => void saveEdit()} disabled={saving} className="px-3 py-1.5 text-xs font-medium bg-brand-500 text-white rounded-lg hover:bg-brand-600 disabled:opacity-50">
                  {saving ? 'Saving…' : 'Save'}
                </button>
                <button onClick={() => void approve()} disabled={saving} className="px-3 py-1.5 text-xs font-medium bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50">
                  Save & Approve
                </button>
                <button onClick={() => setEditing(false)} className="px-3 py-1.5 text-xs text-gray-500 border border-gray-200 rounded-lg hover:bg-gray-50">
                  Cancel
                </button>
              </>
            ) : (
              <button onClick={startEdit} className="px-3 py-1.5 text-xs text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50">
                Edit
              </button>
            )}
            {response.status === 'approved' && (
              <button onClick={() => void copyText()} className="px-3 py-1.5 text-xs font-medium text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50">
                {copied ? 'Copied!' : 'Copy to clipboard'}
              </button>
            )}
          </div>
          {response.status === 'approved' && (
            <p className="text-xs text-gray-400">Copy this text and paste it as your reply on {response.reviewId && 'the platform'}.</p>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Review card ──────────────────────────────────────────────────────────────

function ReviewCard({ review }: { review: Review }) {
  const [showResponse, setShowResponse] = useState(false);

  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 flex-1 min-w-0">
          <Avatar name={review.authorName} />
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-gray-900 text-sm">{review.authorName}</span>
              <PlatformBadge platform={review.platform} />
              {review.status === 'new' && (
                <span className="text-xs bg-yellow-100 text-yellow-700 font-medium px-2 py-0.5 rounded-full">New</span>
              )}
            </div>
            <div className="flex items-center gap-2 mt-0.5">
              <Stars rating={review.rating} />
              <span className="text-xs text-gray-400">
                {review.reviewDate ? new Date(review.reviewDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}
              </span>
            </div>
          </div>
        </div>
        <button
          onClick={() => setShowResponse((v) => !v)}
          className={`flex-shrink-0 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
            showResponse ? 'bg-brand-50 text-brand-600 border-brand-200' : 'text-gray-500 border-gray-200 hover:bg-gray-50'
          }`}
        >
          {showResponse ? 'Hide' : 'Respond'}
        </button>
      </div>
      <p className="mt-3 text-sm text-gray-700 leading-relaxed line-clamp-3">{review.body}</p>
      {showResponse && <ResponsePanel reviewId={review.id} reviewBody={review.body} />}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

const PLATFORMS = ['All', 'Google', 'Yelp', 'Facebook'];
const RATINGS = ['All', '5', '4', '3', '2', '1'];
const STATUSES = ['All', 'New', 'Responded'];

export default function Reviews() {
  const [platform, setPlatform] = useState('All');
  const [rating, setRating] = useState('All');
  const [status, setStatus] = useState('All');
  const [search, setSearch] = useState('');
  const [trendRange, setTrendRange] = useState<TrendRange>(30);

  const params = new URLSearchParams();
  if (platform !== 'All') params.set('platform', platform);
  if (rating !== 'All') params.set('rating', rating);
  if (status !== 'All') params.set('status', status.toLowerCase());
  if (search) params.set('q', search);
  const queryString = params.toString();

  const { data, isLoading, error } = useSWR<{ success: boolean; data: { reviews: Review[]; total: number; page: number; pages: number } }>(
    `/reviews${queryString ? `?${queryString}` : ''}`, fetcher,
  );
  const reviews = data?.data?.reviews ?? [];

  const { data: trendData } = useSWR<{ success: boolean; data: { volume: Array<{ date: string; [k: string]: string | number }>; sentiment: Array<{ date: string; avgRating: number | null }> } }>(
    `/analytics/reviews/trend?days=${trendRange}`, fetcher,
  );

  const volumeData = trendData?.data?.volume ?? [];
  const sentimentData = trendData?.data?.sentiment ?? [];
  const presentPlatforms = Array.from(new Set(volumeData.flatMap((d) => Object.keys(d).filter((k) => k !== 'date'))));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Reviews</h1>
          <p className="text-sm text-gray-500 mt-1">Manage and monitor customer reviews across platforms</p>
        </div>
        <button onClick={() => { window.location.href = '/api/analytics/export?type=reviews'; }}
          className="px-4 py-2 text-sm font-medium text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50">
          Export CSV
        </button>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-gray-900">Review Volume by Platform</h2>
            <div className="flex gap-1">
              {TREND_RANGES.map((r) => (
                <button key={r.value} onClick={() => setTrendRange(r.value)}
                  className={`px-2.5 py-1 text-xs font-medium rounded-lg transition-colors ${trendRange === r.value ? 'bg-brand-500 text-white' : 'text-gray-500 hover:text-gray-900 hover:bg-gray-100'}`}>
                  {r.label}
                </button>
              ))}
            </div>
          </div>
          {volumeData.length === 0 ? (
            <div className="h-40 flex items-center justify-center text-sm text-gray-400">No data yet</div>
          ) : (
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={volumeData} margin={{ top: 2, right: 8, bottom: 2, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#9ca3af' }}
                  tickFormatter={(v: string) => new Date(v).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} />
                <YAxis tick={{ fontSize: 10, fill: '#9ca3af' }} width={24} allowDecimals={false} />
                <Tooltip labelFormatter={(label: string) => new Date(label).toLocaleDateString()} />
                <Legend iconSize={8} wrapperStyle={{ fontSize: 11 }} />
                {presentPlatforms.map((p) => <Bar key={p} dataKey={p} stackId="a" fill={PLATFORM_COLORS[p] ?? '#94a3b8'} />)}
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
          <h2 className="text-sm font-semibold text-gray-900 mb-4">Average Rating Over Time</h2>
          {sentimentData.length === 0 ? (
            <div className="h-40 flex items-center justify-center text-sm text-gray-400">No data yet</div>
          ) : (
            <ResponsiveContainer width="100%" height={180}>
              <LineChart data={sentimentData} margin={{ top: 2, right: 8, bottom: 2, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#9ca3af' }}
                  tickFormatter={(v: string) => new Date(v).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} />
                <YAxis domain={[1, 5]} tick={{ fontSize: 10, fill: '#9ca3af' }} width={24} />
                <Tooltip formatter={(value: number) => [`${value} ★`, 'Avg Rating']}
                  labelFormatter={(label: string) => new Date(label).toLocaleDateString()} />
                <Line type="monotone" dataKey="avgRating" name="Avg Rating" stroke="#F59E0B" strokeWidth={2}
                  dot={{ r: 3, fill: '#F59E0B' }} activeDot={{ r: 5 }} connectNulls />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Filter bar */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 flex flex-wrap gap-3 items-center">
        <select value={platform} onChange={(e) => setPlatform(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500">
          {PLATFORMS.map((p) => <option key={p}>{p}</option>)}
        </select>
        <select value={rating} onChange={(e) => setRating(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500">
          {RATINGS.map((r) => <option key={r} value={r}>{r === 'All' ? 'All ratings' : `${r}★`}</option>)}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500">
          {STATUSES.map((s) => <option key={s}>{s}</option>)}
        </select>
        <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search reviews..."
          className="flex-1 min-w-[160px] border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
      </div>

      {error && <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">Failed to load reviews. Please refresh.</div>}

      {/* Review cards */}
      {isLoading ? (
        <div className="grid gap-4">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 animate-pulse">
              <div className="flex gap-3 mb-3">
                <div className="w-9 h-9 bg-gray-200 rounded-full" />
                <div className="flex-1 space-y-2"><div className="h-4 bg-gray-200 rounded w-32" /><div className="h-3 bg-gray-200 rounded w-20" /></div>
              </div>
              <div className="space-y-2"><div className="h-3 bg-gray-200 rounded w-full" /><div className="h-3 bg-gray-200 rounded w-4/5" /></div>
            </div>
          ))}
        </div>
      ) : reviews.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-12 text-center">
          <p className="text-gray-400 text-sm">No reviews found matching your filters.</p>
        </div>
      ) : (
        <div className="grid gap-4">
          {reviews.map((review) => <ReviewCard key={review.id} review={review} />)}
        </div>
      )}
    </div>
  );
}
