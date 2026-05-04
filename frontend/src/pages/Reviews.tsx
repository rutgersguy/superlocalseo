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
  blReviewId?: string | null;
  blReplyStatus?: string | null;
  blReplyPostedAt?: string | null;
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
      <span className="text-slate-300">{'★'.repeat(5 - Math.max(0, Math.min(5, rating)))}</span>
    </span>
  );
}

function PlatformBadge({ platform }: { platform: string }) {
  const colors: Record<string, string> = {
    Google: 'bg-blue-100 text-blue-700',
    Yelp: 'bg-red-100 text-red-600',
    Facebook: 'bg-indigo-100 text-indigo-700',
  };
  return <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${colors[platform] ?? 'bg-slate-100 text-slate-600'}`}>{platform}</span>;
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

  if (isLoading) return <div className="mt-3 pt-3 border-t border-slate-100 text-xs text-slate-400">Loading response…</div>;

  if (!reviewBody) return (
    <div className="mt-3 pt-3 border-t border-slate-100 text-xs text-slate-400 italic">
      This review has no text — nothing to respond to.
    </div>
  );

  return (
    <div className="mt-3 pt-3 border-t border-slate-100">
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
                className="text-xs text-slate-400 hover:text-slate-600 disabled:opacity-50"
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
            <p className="text-sm text-slate-700 leading-relaxed bg-slate-50 rounded-lg px-3 py-2.5">{displayText}</p>
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
                <button onClick={() => setEditing(false)} className="px-3 py-1.5 text-xs text-slate-500 border border-slate-200 rounded-lg hover:bg-slate-50">
                  Cancel
                </button>
              </>
            ) : (
              <button onClick={startEdit} className="px-3 py-1.5 text-xs text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50">
                Edit
              </button>
            )}
            {response.status === 'approved' && (
              <button onClick={() => void copyText()} className="px-3 py-1.5 text-xs font-medium text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50">
                {copied ? 'Copied!' : 'Copy to clipboard'}
              </button>
            )}
          </div>
          {response.status === 'approved' && (
            <p className="text-xs text-slate-400">Copy this text and paste it as your reply on {response.reviewId && 'the platform'}.</p>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Sync BL button ───────────────────────────────────────────────────────────

function SyncBLButton({ onSynced }: { onSynced: () => void }) {
  const [syncing, setSyncing] = useState(false);
  const handleSync = async () => {
    setSyncing(true);
    try {
      await apiFetch('/reputation/sync', { method: 'POST' });
      onSynced();
    } catch {
      // non-fatal
    } finally {
      setSyncing(false);
    }
  };
  return (
    <button onClick={() => void handleSync()} disabled={syncing}
      className="px-1.5 py-1 text-xs sm:px-4 sm:py-2 sm:text-sm font-medium text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors disabled:opacity-50">
      {syncing ? 'Syncing…' : 'Sync Reviews'}
    </button>
  );
}

// ─── BL Reply Modal ───────────────────────────────────────────────────────────

function PostReplyModal({ review, onClose, onPosted }: { review: Review; onClose: () => void; onPosted: () => void }) {
  const { data: responseData } = useSWR<{ success: boolean; data: ReviewResponse | null }>(
    `/reviews/${review.id}/response`, fetcher,
  );
  const aiDraft = responseData?.data?.finalBody ?? responseData?.data?.draftBody ?? '';
  const [text, setText] = useState('');
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Pre-fill with AI draft once loaded
  const effectiveText = text || aiDraft;

  const handlePost = async () => {
    setPosting(true);
    setError(null);
    try {
      await apiFetch(`/reputation/reviews/${review.id}/reply`, {
        method: 'POST',
        body: JSON.stringify({ replyText: effectiveText }),
      });
      onPosted();
    } catch (e) {
      setError((e as Error).message ?? 'Failed to post reply');
    } finally {
      setPosting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg flex flex-col">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-900">Post Reply to Google</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 font-bold text-xl">×</button>
        </div>
        <div className="px-6 py-4 space-y-3">
          <p className="text-sm text-slate-500">
            Replying to <span className="font-medium text-slate-700">{review.authorName}</span>
          </p>
          <textarea
            value={text || aiDraft}
            onChange={(e) => setText(e.target.value)}
            rows={5}
            maxLength={4000}
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 resize-none"
            placeholder="Write your reply…"
          />
          <p className="text-xs text-slate-400 text-right">{effectiveText.length}/4000</p>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
        <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 text-sm text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50">Cancel</button>
          <button onClick={() => void handlePost()} disabled={posting || !effectiveText.trim()}
            className="px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
            {posting ? 'Posting…' : 'Post to Google'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Review card ──────────────────────────────────────────────────────────────

function ReviewCard({ review, onReplyPosted }: { review: Review; onReplyPosted: () => void }) {
  const [showResponse, setShowResponse] = useState(false);
  const [showReplyModal, setShowReplyModal] = useState(false);

  const canPostBL = !!review.blReviewId && review.blReplyStatus !== 'posted';
  const alreadyPosted = review.blReplyStatus === 'posted';

  return (
    <div className="bg-white rounded-xl shadow-card p-5">
      {showReplyModal && (
        <PostReplyModal
          review={review}
          onClose={() => setShowReplyModal(false)}
          onPosted={() => { setShowReplyModal(false); onReplyPosted(); }}
        />
      )}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 flex-1 min-w-0">
          <Avatar name={review.authorName} />
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-slate-900 text-sm">{review.authorName}</span>
              <PlatformBadge platform={review.platform} />
              {review.status === 'new' && (
                <span className="text-xs bg-yellow-100 text-yellow-700 font-medium px-2 py-0.5 rounded-full">New</span>
              )}
              {alreadyPosted && (
                <span className="text-xs bg-green-100 text-green-700 font-medium px-2 py-0.5 rounded-full">
                  ✓ Replied {review.blReplyPostedAt ? new Date(review.blReplyPostedAt).toLocaleDateString() : ''}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 mt-0.5">
              <Stars rating={review.rating} />
              <span className="text-xs text-slate-400">
                {review.reviewDate ? new Date(review.reviewDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}
              </span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {canPostBL && (
            <button
              onClick={() => setShowReplyModal(true)}
              className="px-3 py-1.5 text-xs font-medium text-blue-600 border border-blue-200 rounded-lg hover:bg-blue-50"
            >
              Post to Google
            </button>
          )}
          <button
            onClick={() => setShowResponse((v) => !v)}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
              showResponse ? 'bg-brand-50 text-brand-600 border-brand-200' : 'text-slate-500 border-slate-200 hover:bg-slate-50'
            }`}
          >
            {showResponse ? 'Hide' : 'Respond'}
          </button>
        </div>
      </div>
      <p className="mt-3 text-sm text-slate-700 leading-relaxed line-clamp-3">{review.body}</p>
      {showResponse && <ResponsePanel reviewId={review.id} reviewBody={review.body} />}
    </div>
  );
}

// ─── Feedback tab ─────────────────────────────────────────────────────────────

function FeedbackTab() {
  const { data, isLoading } = useSWR<{ success: boolean; data: { feedback: any[]; total: number } }>('/reviews/feedback', fetcher);
  const feedback = data?.data?.feedback ?? [];
  const total = data?.data?.total ?? 0;

  if (isLoading) return <div className="text-sm text-slate-500">Loading...</div>;

  if (feedback.length === 0) {
    return (
      <div className="text-center py-16 text-slate-400">
        <p className="font-medium text-slate-600 mb-1">No private feedback yet</p>
        <p className="text-sm">When a review requester rates 1–3★, their response appears here instead of going to Google.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-500">{total} private responses</p>
      {feedback.map((f: any) => (
        <div key={f.id} className="bg-white rounded-xl p-4 shadow-card">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                {f.contactName && <span className="text-sm font-medium text-slate-800">{f.contactName}</span>}
                <span className="text-xs bg-amber-50 text-amber-700 px-2 py-0.5 rounded-full font-medium">Private</span>
                {f.rating && (
                  <span className="text-xs text-slate-500">{'★'.repeat(f.rating)}{'☆'.repeat(5 - f.rating)}</span>
                )}
              </div>
              {f.contactEmail && <p className="text-xs text-slate-400">{f.contactEmail}</p>}
              {f.message && <p className="text-sm text-slate-700 mt-2">{f.message}</p>}
            </div>
            <span className="text-xs text-slate-400 whitespace-nowrap">
              {new Date(f.receivedAt).toLocaleDateString()}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

const PLATFORMS = ['All', 'Google', 'Yelp', 'Facebook'];
const RATINGS = ['All', '5', '4', '3', '2', '1'];
const STATUSES = ['All', 'New', 'Responded'];

type ActiveTab = 'reviews' | 'feedback';

export default function Reviews() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('reviews');
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

  const { data, isLoading, error, mutate: mutateReviews } = useSWR<{ success: boolean; data: { reviews: Review[]; total: number; page: number; pages: number } }>(
    `/reviews${queryString ? `?${queryString}` : ''}`, fetcher,
  );
  const reviews = data?.data?.reviews ?? [];

  const { data: feedbackData } = useSWR<{ success: boolean; data: { feedback: any[]; total: number } }>('/reviews/feedback', fetcher);
  const feedbackTotal = feedbackData?.data?.total ?? 0;

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
          <h1 className="text-xl font-bold text-slate-900 tracking-tight">Reviews</h1>
          <p className="text-sm text-slate-500 mt-1">Manage and monitor customer reviews across platforms</p>
        </div>
        <div className="flex gap-2">
          <SyncBLButton onSynced={() => void mutateReviews()} />
          <button onClick={() => { window.location.href = '/api/analytics/export?type=reviews'; }}
            className="px-1.5 py-1 text-xs sm:px-4 sm:py-2 sm:text-sm font-medium text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors">
            Export CSV
          </button>
        </div>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl shadow-card p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-slate-900">Review Volume by Platform</h2>
            <div className="flex gap-1">
              {TREND_RANGES.map((r) => (
                <button key={r.value} onClick={() => setTrendRange(r.value)}
                  className={`px-2.5 py-1 text-xs font-medium rounded-lg transition-colors ${trendRange === r.value ? 'bg-brand-500 text-white' : 'text-slate-500 hover:text-slate-900 hover:bg-slate-100'}`}>
                  {r.label}
                </button>
              ))}
            </div>
          </div>
          {volumeData.length === 0 ? (
            <div className="h-40 flex items-center justify-center text-sm text-slate-400">No data yet</div>
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
        <div className="bg-white rounded-xl shadow-card p-5">
          <h2 className="text-sm font-semibold text-slate-900 mb-4">Average Rating Over Time</h2>
          {sentimentData.length === 0 ? (
            <div className="h-40 flex items-center justify-center text-sm text-slate-400">No data yet</div>
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

      {/* Tab bar */}
      <div className="flex gap-1 border-b border-slate-200">
        <button
          onClick={() => setActiveTab('reviews')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === 'reviews' ? 'border-brand-500 text-brand-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
        >
          Reviews
        </button>
        <button
          onClick={() => setActiveTab('feedback')}
          className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === 'feedback' ? 'border-brand-500 text-brand-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
        >
          Private Feedback
          {feedbackTotal > 0 && (
            <span className="text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full font-medium">{feedbackTotal}</span>
          )}
        </button>
      </div>

      {activeTab === 'feedback' ? (
        <FeedbackTab />
      ) : (
        <>
          {/* Filter bar */}
          <div className="bg-white rounded-xl shadow-card p-4 flex flex-wrap gap-3 items-center">
            <select value={platform} onChange={(e) => setPlatform(e.target.value)}
              className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500">
              {PLATFORMS.map((p) => <option key={p}>{p}</option>)}
            </select>
            <select value={rating} onChange={(e) => setRating(e.target.value)}
              className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500">
              {RATINGS.map((r) => <option key={r} value={r}>{r === 'All' ? 'All ratings' : `${r}★`}</option>)}
            </select>
            <select value={status} onChange={(e) => setStatus(e.target.value)}
              className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500">
              {STATUSES.map((s) => <option key={s}>{s}</option>)}
            </select>
            <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search reviews..."
              className="flex-1 min-w-[160px] border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
          </div>

          {error && <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">Failed to load reviews. Please refresh.</div>}

          {isLoading ? (
            <div className="grid gap-4">
              {Array.from({ length: 4 }, (_, i) => (
                <div key={i} className="bg-white rounded-xl shadow-card p-5 animate-pulse">
                  <div className="flex gap-3 mb-3">
                    <div className="w-9 h-9 bg-slate-100 rounded-full" />
                    <div className="flex-1 space-y-2"><div className="h-4 bg-slate-100 rounded w-32" /><div className="h-3 bg-slate-100 rounded w-20" /></div>
                  </div>
                  <div className="space-y-2"><div className="h-3 bg-slate-100 rounded w-full" /><div className="h-3 bg-slate-100 rounded w-4/5" /></div>
                </div>
              ))}
            </div>
          ) : reviews.length === 0 ? (
            <div className="bg-white rounded-xl shadow-card p-12 text-center">
              <p className="text-slate-400 text-sm">No reviews found matching your filters.</p>
            </div>
          ) : (
            <div className="grid gap-4">
              {reviews.map((review) => <ReviewCard key={review.id} review={review} onReplyPosted={() => void mutateReviews()} />)}
            </div>
          )}
        </>
      )}
    </div>
  );
}
