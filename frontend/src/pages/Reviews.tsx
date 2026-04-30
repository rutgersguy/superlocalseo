import { useState } from 'react';
import useSWR from 'swr';
import { fetcher } from '../services/api';

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

interface ReviewsResponse {
  success: boolean;
  data: { reviews: Review[]; total: number; page: number; pages: number };
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
  const cls = colors[platform] ?? 'bg-gray-100 text-gray-600';
  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${cls}`}>{platform}</span>
  );
}

function Avatar({ name }: { name: string }) {
  const initials = (name || '?')
    .split(' ')
    .slice(0, 2)
    .map((s) => s[0] ?? '')
    .join('')
    .toUpperCase() || '?';
  return (
    <div className="w-9 h-9 rounded-full bg-brand-500 text-white text-sm font-semibold flex items-center justify-center flex-shrink-0">
      {initials}
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

  // Build query string
  const params = new URLSearchParams();
  if (platform !== 'All') params.set('platform', platform);
  if (rating !== 'All') params.set('rating', rating);
  if (status !== 'All') params.set('status', status.toLowerCase());
  if (search) params.set('q', search);
  const queryString = params.toString();

  const swrKey = `/reviews${queryString ? `?${queryString}` : ''}`;
  const { data, isLoading, error } = useSWR<ReviewsResponse>(swrKey, fetcher);
  const reviews = data?.data?.reviews ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Reviews</h1>
        <p className="text-sm text-gray-500 mt-1">Manage and monitor customer reviews across platforms</p>
      </div>

      {/* Filter bar */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 flex flex-wrap gap-3 items-center">
        <select
          value={platform}
          onChange={(e) => setPlatform(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
        >
          {PLATFORMS.map((p) => <option key={p}>{p}</option>)}
        </select>

        <select
          value={rating}
          onChange={(e) => setRating(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
        >
          {RATINGS.map((r) => (
            <option key={r} value={r}>{r === 'All' ? 'All ratings' : `${r}★`}</option>
          ))}
        </select>

        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
        >
          {STATUSES.map((s) => <option key={s}>{s}</option>)}
        </select>

        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search reviews..."
          className="flex-1 min-w-[160px] border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
        />
      </div>

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          Failed to load reviews. Please refresh.
        </div>
      )}

      {/* Review cards */}
      {isLoading ? (
        <div className="grid gap-4">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 animate-pulse">
              <div className="flex gap-3 mb-3">
                <div className="w-9 h-9 bg-gray-200 rounded-full" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 bg-gray-200 rounded w-32" />
                  <div className="h-3 bg-gray-200 rounded w-20" />
                </div>
              </div>
              <div className="space-y-2">
                <div className="h-3 bg-gray-200 rounded w-full" />
                <div className="h-3 bg-gray-200 rounded w-4/5" />
              </div>
            </div>
          ))}
        </div>
      ) : reviews.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-12 text-center">
          <p className="text-gray-400 text-sm">No reviews found matching your filters.</p>
        </div>
      ) : (
        <div className="grid gap-4">
          {reviews.map((review) => (
            <div key={review.id} className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
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
              </div>
              <p className="mt-3 text-sm text-gray-700 leading-relaxed line-clamp-3">{review.body}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
