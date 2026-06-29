import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { CheckCircle2, ShieldCheck, Lock, Tag, X } from 'lucide-react';
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
  productLine: 'lite' | 'pro';
}

interface IntentResponse {
  success: boolean;
  data: { clientSecret: string; subscriptionId: string; publishableKey: string };
  error?: { message: string };
}

interface PromoResponse {
  success: boolean;
  data: { id: string; discount: string; duration: string; applyTo: string };
  error?: { message: string };
}

// ─── Checkout form (inside Elements context) ─────────────────────────────────

function CheckoutForm({ onSuccess: _onSuccess }: { onSuccess: () => void }) {
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
  const [proceedEarly, setProceedEarly] = useState(false);

  const [promoInput, setPromoInput] = useState('');
  const [promoLoading, setPromoLoading] = useState(false);
  const [promoApplied, setPromoApplied] = useState<{ id: string; discount: string; duration: string; applyTo: string } | null>(null);
  const [promoError, setPromoError] = useState('');

  // Check for success return from Stripe
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('payment_intent') && params.get('redirect_status') === 'succeeded') {
      setSuccess(true);
    }
  }, []);

  // Determine if user is in early trial (show soft landing instead of payment form).
  // Trial is 7 days; show the soft landing for the first few days, then the payment form
  // once 3 or fewer days remain.
  const isEarlyTrial = billing?.status === 'trialing' && billing.trialDaysLeft !== null && billing.trialDaysLeft > 3;
  // Plan chosen at registration (Option B: trials run as Pro; the plan applies at checkout).
  // Fall back to the client's CURRENT plan (not Lite) when no choice is stored, so existing
  // trial users mid-funnel at deploy aren't silently checked out on the cheaper Lite price.
  const storedPlan = localStorage.getItem('selectedPlan');
  const planForCheckout: 'lite' | 'pro' =
    storedPlan === 'lite' || storedPlan === 'pro' ? storedPlan : (billing?.productLine ?? 'pro');
  const isUpgrade = new URLSearchParams(window.location.search).get('upgrade') === '1';

  // Fetch subscription intent when status is known and user needs to subscribe
  useEffect(() => {
    if (success) return;
    if (!billing) return;
    if (billing.status === 'active') return;
    if (isEarlyTrial && !proceedEarly) return; // don't create intent until user opts in
    if (clientSecret) return;

    setLoadingIntent(true);
    apiFetch<IntentResponse>('/billing/subscription-intent', {
      method: 'POST',
      body: JSON.stringify({ plan: planForCheckout, extraLocations: 0, promotionCodeId: promoApplied?.id }),
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
  }, [billing, clientSecret, isEarlyTrial, proceedEarly]);

  // Lite→Pro upgrade: call /billing/upgrade and reuse the payment form for confirmation.
  // product_line flips to 'pro' on the invoice.payment_succeeded webhook once paid.
  useEffect(() => {
    if (!isUpgrade || success) return;
    if (!billing || billing.status !== 'active' || billing.productLine !== 'lite') return;
    if (clientSecret || loadingIntent) return;

    setLoadingIntent(true);
    apiFetch<{ success: boolean; data: { clientSecret: string | null }; error?: { message?: string } }>(
      '/billing/upgrade', { method: 'POST' },
    )
      .then((res) => {
        if (!res.success) { setIntentError(res.error?.message ?? 'Upgrade failed'); return; }
        if (res.data.clientSecret) {
          setClientSecret(res.data.clientSecret);
          setPubKey(billing.publishableKey);
        } else {
          setSuccess(true); // covered by proration credit — no extra payment needed
        }
      })
      .catch(() => setIntentError('Network error — please refresh'))
      .finally(() => setLoadingIntent(false));
  }, [isUpgrade, billing, clientSecret, loadingIntent, success]);

  const applyPromo = async () => {
    const code = promoInput.trim();
    if (!code) return;
    setPromoLoading(true);
    setPromoError('');
    try {
      const res = await apiFetch<PromoResponse>('/billing/validate-promo', {
        method: 'POST',
        body: JSON.stringify({ code }),
      });
      if (!res.success || !res.data) {
        setPromoError(res.error?.message ?? 'Invalid or expired promo code');
        return;
      }
      setPromoApplied(res.data);
      // Reset intent so it recreates with promo applied
      setClientSecret(null);
    } catch {
      setPromoError('Network error — please try again');
    } finally {
      setPromoLoading(false);
    }
  };

  const removePromo = () => {
    setPromoApplied(null);
    setPromoInput('');
    setPromoError('');
    setClientSecret(null);
  };

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

  // Already subscribed — but let an active Lite subscriber who chose to upgrade
  // (?upgrade=1) fall through to the upgrade payment form below.
  if (billing?.status === 'active' && !(isUpgrade && billing.productLine === 'lite')) {
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

  // Early trial soft landing — don't show payment form unless they opt in
  if (isEarlyTrial && !proceedEarly) {
    const days = billing!.trialDaysLeft!;
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8 max-w-sm w-full text-center space-y-5">
          <div className="w-16 h-16 bg-blue-50 rounded-full flex items-center justify-center mx-auto">
            <ShieldCheck size={28} className="text-blue-500" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900">You're on a free trial</h1>
            <p className="text-sm text-slate-500 mt-2 leading-relaxed">
              You have <strong className="text-slate-700">{days} day{days === 1 ? '' : 's'}</strong> left — no payment needed yet.
              Keep exploring the platform and subscribe when you're ready.
            </p>
          </div>
          <Link
            to="/dashboard"
            className="block w-full py-2.5 rounded-lg bg-brand-500 text-white text-sm font-semibold hover:bg-brand-600 transition-colors"
          >
            Back to dashboard
          </Link>
          <button
            onClick={() => setProceedEarly(true)}
            className="block w-full text-sm text-slate-400 hover:text-slate-600 transition-colors py-1"
          >
            Subscribe early anyway →
          </button>
          <button onClick={() => void logout()} className="block w-full text-xs text-slate-300 hover:text-slate-500 transition-colors">
            Sign out
          </button>
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
          <img src="/sls_logo_wide_color.png" alt="SuperLocalSEO" className="h-7 w-auto" />
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
          <p className="text-xs text-slate-400 mb-5">Your card will be charged $848 today, then $349/mo.</p>

          {/* Promo code */}
          {!promoApplied ? (
            <div className="mb-6">
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Tag size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    value={promoInput}
                    onChange={(e) => setPromoInput(e.target.value.toUpperCase())}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void applyPromo(); } }}
                    placeholder="Promo code"
                    className="w-full pl-8 pr-3 py-2.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 placeholder:text-slate-300 tracking-wide"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => void applyPromo()}
                  disabled={!promoInput.trim() || promoLoading}
                  className="px-4 py-2.5 text-sm font-medium text-indigo-600 border border-indigo-200 rounded-lg hover:bg-indigo-50 disabled:opacity-50 whitespace-nowrap transition-colors"
                >
                  {promoLoading ? '…' : 'Apply'}
                </button>
              </div>
              {promoError && <p className="mt-1.5 text-xs text-red-600">{promoError}</p>}
            </div>
          ) : (
            <div className="mb-6 flex items-center justify-between px-3 py-2.5 bg-green-50 border border-green-200 rounded-lg">
              <div className="flex items-center gap-2">
                <CheckCircle2 size={14} className="text-green-500 shrink-0" />
                <div>
                  <span className="text-sm font-medium text-green-800">{promoInput} applied</span>
                  <span className="ml-2 text-xs text-green-600">
                    {promoApplied.discount} · {promoApplied.duration}
                    {promoApplied.applyTo === 'setup' ? ' · setup fee only' : promoApplied.applyTo === 'monthly' ? ' · monthly only' : ''}
                  </span>
                </div>
              </div>
              <button type="button" onClick={removePromo} className="text-green-500 hover:text-green-700 ml-2">
                <X size={14} />
              </button>
            </div>
          )}

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
