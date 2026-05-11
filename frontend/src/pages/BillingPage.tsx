import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { BarChart2, CheckCircle2, ShieldCheck, Lock } from 'lucide-react';
import useSWR from 'swr';
import { fetcher, apiFetch } from '../services/api';
import { useAuth } from '../hooks/useAuth';

// ─── Types ────────────────────────────────────────────────────────────────────

interface BillingStatus {
  status: string;
  trialDaysLeft: number | null;
  locationsLimit: number;
  locationCount: number;
  currentPeriodEnd: string | null;
  publishableKey: string | null;
}

interface IntentResponse {
  success: boolean;
  data: { clientSecret: string; subscriptionId: string; publishableKey: string };
  error?: { message: string };
}

// ─── Checkout form (inside Elements context) ─────────────────────────────────

function CheckoutForm({ onSuccess }: { onSuccess: () => void }) {
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stripe || !elements) return;
    setSubmitting(true);
    setError('');

    const { error: stripeError } = await stripe.confirmPayment({
      elements,
      confirmParams: {
        return_url: `${window.location.origin}/billing`,
      },
    });

    // Only reaches here on error — success redirects automatically
    if (stripeError) {
      setError(stripeError.message ?? 'Payment failed. Please try again.');
    }
    setSubmitting(false);
  };

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="space-y-5">
      <PaymentElement
        options={{
          layout: 'tabs',
          fields: { billingDetails: { address: { country: 'never' } } },
        }}
      />

      {error && (
        <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          <span className="shrink-0 mt-0.5">⚠</span>
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={!stripe || submitting}
        className="w-full py-3.5 rounded-xl font-semibold text-sm text-white transition-all disabled:opacity-60 flex items-center justify-center gap-2"
        style={{ background: '#6366f1', boxShadow: '0 4px 16px rgba(99,102,241,0.35)' }}
      >
        {submitting && <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
        {submitting ? 'Processing…' : 'Subscribe now →'}
      </button>

      <div className="flex items-center justify-center gap-1.5 text-xs text-slate-400">
        <Lock size={11} />
        Secured by Stripe · Cancel anytime
      </div>
    </form>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

const FEATURES = [
  'Daily rank tracking across all keywords',
  'Review Monitoring + AI Replies',
  'Competitor benchmarking & analysis',
  'Citation health monitoring & builder',
  'Automated monthly PDF reports',
  'Review request campaigns via email & SMS',
  'ROI & revenue attribution dashboard',
  'Unlimited team members & roles',
];

export default function BillingPage() {
  const { logout } = useAuth();
  const { data: statusData } = useSWR<{ success: boolean; data: BillingStatus }>('/billing/status', fetcher);
  const billing = statusData?.data;

  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [publishableKey, setPubKey] = useState<string | null>(null);
  const [intentError, setIntentError] = useState('');
  const [loadingIntent, setLoadingIntent] = useState(false);
  const [success, setSuccess] = useState(false);

  // Check for success return from Stripe
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('payment_intent') && params.get('redirect_status') === 'succeeded') {
      setSuccess(true);
    }
  }, []);

  // Fetch subscription intent when status is known and user needs to subscribe
  useEffect(() => {
    if (success) return;
    if (!billing) return;
    if (billing.status === 'active') return;
    if (clientSecret) return;

    setLoadingIntent(true);
    apiFetch<IntentResponse>('/billing/subscription-intent', {
      method: 'POST',
      body: JSON.stringify({ extraLocations: 0 }),
    })
      .then((res) => {
        if (!res.success || !res.data?.clientSecret) {
          setIntentError(res.error?.message ?? 'Could not initialize payment');
          return;
        }
        setClientSecret(res.data.clientSecret);
        setPubKey(res.data.publishableKey ?? billing.publishableKey);
      })
      .catch(() => setIntentError('Network error — please refresh'))
      .finally(() => setLoadingIntent(false));
  }, [billing, clientSecret]);

  const stripePromise = publishableKey ? loadStripe(publishableKey) : null;

  const stripeAppearance = {
    theme: 'stripe' as const,
    variables: {
      colorPrimary: '#6366f1',
      colorBackground: '#ffffff',
      colorText: '#0f172a',
      colorDanger: '#ef4444',
      fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
      borderRadius: '8px',
      spacingUnit: '4px',
    },
    rules: {
      '.Input': { border: '1px solid #e2e8f0', boxShadow: 'none', padding: '10px 12px' },
      '.Input:focus': { border: '1px solid #6366f1', boxShadow: '0 0 0 3px rgba(99,102,241,0.15)' },
      '.Label': { fontWeight: '500', color: '#475569', marginBottom: '6px' },
      '.Tab': { border: '1px solid #e2e8f0' },
      '.Tab--selected': { borderColor: '#6366f1', backgroundColor: '#eef2ff' },
    },
  };

  // Already subscribed
  if (billing?.status === 'active') {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8 max-w-sm w-full text-center space-y-4">
          <CheckCircle2 size={40} className="text-green-500 mx-auto" />
          <h1 className="text-lg font-bold text-slate-900">You're already subscribed</h1>
          <p className="text-sm text-slate-500">Manage your plan, payment method, or invoices below.</p>
          <a href="/dashboard/settings?tab=billing"
            className="block w-full py-2.5 rounded-lg bg-brand-500 text-white text-sm font-semibold hover:bg-brand-600 transition-colors">
            Go to billing settings
          </a>
          <Link to="/dashboard" className="block text-sm text-slate-400 hover:text-slate-600">← Back to dashboard</Link>
        </div>
      </div>
    );
  }

  // Success state (returned from Stripe)
  if (success) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8 max-w-sm w-full text-center space-y-4">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto">
            <CheckCircle2 size={32} className="text-green-500" />
          </div>
          <h1 className="text-xl font-bold text-slate-900">You're in!</h1>
          <p className="text-sm text-slate-500">Your subscription is active. Welcome to SuperLocalSEO.</p>
          <Link to="/dashboard"
            className="block w-full py-3 rounded-xl bg-brand-500 text-white text-sm font-semibold hover:bg-brand-600 transition-colors">
            Go to dashboard →
          </Link>
        </div>
      </div>
    );
  }

  const days = billing?.trialDaysLeft;
  const trialExpired = billing?.status === 'canceled' || (days !== null && days !== undefined && days <= 0);

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Top nav strip */}
      <div className="bg-white border-b border-slate-100 px-6 py-3 flex items-center justify-between">
        <Link to="/dashboard" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
          <div className="w-6 h-6 rounded-md bg-brand-500 flex items-center justify-center shrink-0">
            <BarChart2 size={12} className="text-white" />
          </div>
          <span className="text-sm font-bold text-slate-900 tracking-tight">SuperLocalSEO</span>
        </Link>
        <button onClick={() => void logout()} className="text-xs text-slate-400 hover:text-slate-600 transition-colors">
          Sign out
        </button>
      </div>

      <div className="max-w-5xl mx-auto px-4 py-10 sm:py-16 grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-14 items-start">

        {/* ── Left: Plan Summary ─────────────────────────────────────── */}
        <div className="space-y-6">
          <div>
            {trialExpired ? (
              <div className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full bg-red-50 text-red-600 border border-red-200 mb-3">
                Trial ended
              </div>
            ) : days !== null && days !== undefined ? (
              <div className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full bg-indigo-50 text-indigo-600 border border-indigo-200 mb-3">
                {days === 1 ? '1 day left in trial' : `${days} days left in trial`}
              </div>
            ) : null}
            <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 leading-snug">
              {trialExpired ? 'Reactivate your account' : 'Subscribe to SuperLocalSEO'}
            </h1>
            <p className="text-slate-500 mt-2 text-sm leading-relaxed">
              {trialExpired
                ? 'Your data is saved. Subscribe to pick up exactly where you left off.'
                : 'Lock in your rankings, reviews, and citation data for the long haul.'}
            </p>
          </div>

          {/* Pricing breakdown */}
          <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-1">What you're subscribing to</p>
            <div className="flex items-center justify-between py-2 border-b border-slate-100">
              <div>
                <p className="text-sm font-medium text-slate-800">Monthly subscription</p>
                <p className="text-xs text-slate-400 mt-0.5">1 location · cancel anytime</p>
              </div>
              <span className="text-sm font-semibold text-slate-900">$349/mo</span>
            </div>
            <div className="flex items-center justify-between py-2 border-b border-slate-100">
              <div>
                <p className="text-sm font-medium text-slate-800">One-time setup fee</p>
                <p className="text-xs text-slate-400 mt-0.5">Onboarding, configuration & citation audit</p>
              </div>
              <span className="text-sm font-semibold text-slate-900">$499</span>
            </div>
            <div className="flex items-center justify-between pt-1">
              <p className="text-sm font-semibold text-slate-900">Due today</p>
              <p className="text-lg font-bold text-slate-900">$848</p>
            </div>
            <p className="text-xs text-slate-400">Then $349/mo. +$125/mo per additional location. Cancel anytime.</p>
          </div>

          {/* Feature list */}
          <ul className="space-y-2.5">
            {FEATURES.map((f) => (
              <li key={f} className="flex items-start gap-3 text-sm text-slate-700">
                <span className="mt-0.5 w-4 h-4 rounded-full shrink-0 flex items-center justify-center text-xs font-bold"
                  style={{ background: 'rgba(99,102,241,0.12)', color: '#6366f1' }}>✓</span>
                {f}
              </li>
            ))}
          </ul>

          {/* Trust strip */}
          <div className="flex items-center gap-5 pt-2 text-xs text-slate-400">
            <span className="flex items-center gap-1.5"><ShieldCheck size={14} className="text-slate-400" /> 256-bit encryption</span>
            <span className="flex items-center gap-1.5"><Lock size={14} className="text-slate-400" /> Powered by Stripe</span>
          </div>
        </div>

        {/* ── Right: Payment Form ────────────────────────────────────── */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 sm:p-8">
          <h2 className="text-base font-semibold text-slate-900 mb-1">Payment details</h2>
          <p className="text-xs text-slate-400 mb-8">Your card will be charged $848 today, then $349/mo.</p>

          {loadingIntent && (
            <div className="space-y-3 animate-pulse">
              {[80, 60, 80, 100].map((w, i) => (
                <div key={i} className="h-10 bg-slate-100 rounded-lg" style={{ width: `${w}%` }} />
              ))}
            </div>
          )}

          {intentError && (
            <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700 text-center space-y-2">
              <p>{intentError}</p>
              <button onClick={() => window.location.reload()}
                className="text-xs underline hover:no-underline">Try again</button>
            </div>
          )}

          {clientSecret && stripePromise && (
            <Elements stripe={stripePromise} options={{ clientSecret, appearance: stripeAppearance }}>
              <CheckoutForm onSuccess={() => setSuccess(true)} />
            </Elements>
          )}
        </div>
      </div>
    </div>
  );
}
