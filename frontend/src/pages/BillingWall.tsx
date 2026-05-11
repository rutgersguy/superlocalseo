import { useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { apiFetch } from '../services/api';

export default function BillingWall() {
  const { logout } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubscribe = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch<{ success: boolean; data?: { url: string }; error?: { message: string } }>('/billing/checkout', {
        method: 'POST',
        body: JSON.stringify({ extraLocations: 0 }),
      });
      if (!res.success || !res.data?.url) throw new Error(res.error?.message ?? 'Could not start checkout');
      window.location.href = res.data.url;
    } catch (e) {
      setError((e as Error).message);
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center px-4">
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8 max-w-md w-full text-center space-y-6">
        <div className="w-14 h-14 bg-amber-100 rounded-full flex items-center justify-center mx-auto">
          <svg className="w-7 h-7 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
          </svg>
        </div>

        <div>
          <h1 className="text-xl font-bold text-slate-900 mb-2">Subscription required</h1>
          <p className="text-sm text-slate-600 leading-relaxed">
            Your access to SuperLocalSEO has been paused. Subscribe to continue tracking your rankings, reviews, and citations.
          </p>
        </div>

        <div className="bg-slate-50 rounded-xl p-4 text-left space-y-2">
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-bold text-slate-900">$349</span>
            <span className="text-slate-500 text-sm">/mo</span>
          </div>
          <p className="text-xs text-slate-500">+ $499 one-time setup fee · $125/mo per extra location</p>
          <ul className="mt-3 space-y-1.5">
            {['Daily rank tracking', 'Review monitoring + AI responses', 'Citation health', 'Monthly PDF reports', 'Review request campaigns'].map((f) => (
              <li key={f} className="text-xs text-slate-600 flex items-center gap-1.5">
                <span className="text-brand-500">✓</span> {f}
              </li>
            ))}
          </ul>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button
          onClick={() => void handleSubscribe()}
          disabled={loading}
          className="w-full py-3 rounded-lg font-semibold text-sm bg-brand-500 text-white hover:bg-brand-600 transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
        >
          {loading && <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
          Subscribe now
        </button>

        <button
          onClick={() => void logout()}
          className="text-sm text-slate-400 hover:text-slate-600 transition-colors"
        >
          Sign out
        </button>
      </div>
    </div>
  );
}
