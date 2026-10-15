import { useState, useMemo } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { Lock } from 'lucide-react';
import useSWR from 'swr';
import { fetcher, apiFetch } from '../services/api';
import { PlanPicker } from '../components/PlanPicker';
import { usePlans, money, PlanKey, BillingInterval } from '../hooks/usePlans';
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

    try {
      const { error: stripeError } = await stripe.confirmPayment({
        elements,
        confirmParams: { return_url: `${window.location.origin}/billing` },
      });
      if (stripeError) setError(stripeError.message ?? 'Payment failed. Please try again.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Payment could not be submitted. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="space-y-5">
      <PaymentElement
        options={{
          layout: 'tabs',
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


function SubscriptionCheckout() {
  const { data, mutate } = useSWR<{ data: { status: string; trialDaysLeft: number | null; pricingVersion: string } }>('/billing/status', fetcher, { refreshInterval: value => new URLSearchParams(location.search).get('redirect_status') === 'succeeded' && value?.data.status !== 'active' ? 2000 : 0 });
  const { data: plans } = usePlans();
  const stored = localStorage.getItem('selectedPlan');
  const [plan, setPlan] = useState<PlanKey>(stored === 'multi' ? 'multi' : stored === 'starter' || stored === 'lite' ? 'starter' : 'pro');
  const [interval, setInterval] = useState<BillingInterval>(localStorage.getItem('selectedInterval') === 'year' ? 'year' : 'month');
  const [promo, setPromo] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const [intent, setIntent] = useState<{ clientSecret: string | null; publishableKey: string; amountDue: number } | null>(null);
  const [quote, setQuote] = useState<{ amountDue: number; renewalAmount: number; renewalDiscount: string | null; discount: string | null; promotionCodeId?: string; previewToken: string } | null>(null);
  const [success, setSuccess] = useState(false);
  const stripe = useMemo(() => intent?.publishableKey ? loadStripe(intent.publishableKey) : null, [intent?.publishableKey]);
  const definition = plans?.data.plans[plan];
  const billing = data?.data;
  async function start() {
    if (busy) return; setBusy(true); setError('');
    try {
      if (!quote) {
        const preview = await apiFetch<{ success: boolean; data: { amountDue: number; renewalAmount: number; renewalDiscount: string | null; discount: string | null; promotionCodeId?: string; previewToken: string }; error?: { message: string } }>('/billing/subscription-preview', { method: 'POST', body: JSON.stringify({ plan, interval, extraLocations: 0, promoCode: promo.trim() }) });
        if (!preview.success) throw new Error(preview.error?.message || 'Unable to preview checkout');
        setQuote(preview.data); return;
      }
      const r = await apiFetch<{ success: boolean; data: { clientSecret: string | null; publishableKey: string; paymentRequired: boolean; amountDue: number }; error?: { message: string } }>('/billing/subscription-intent', { method: 'POST', body: JSON.stringify({ plan, interval, extraLocations: 0, promotionCodeId: quote.promotionCodeId, previewToken: quote.previewToken }) });
      if (!r.success) throw new Error(r.error?.message || 'Unable to begin checkout');
      if (!r.data.paymentRequired) { setSuccess(true); await mutate(); } else setIntent(r.data);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  if (success || billing?.status === 'active') return <div className="p-10 space-y-4"><h1 className="text-2xl font-bold">Your subscription is active</h1><Link className="underline text-brand-700" to="/dashboard/settings?tab=billing">Manage billing</Link><Link className="block underline" to="/dashboard">Go to dashboard</Link></div>;
  if (new URLSearchParams(location.search).get('redirect_status') === 'succeeded') return <div className="p-10 space-y-4"><h1 className="text-2xl font-bold">Confirming your subscription</h1><p>Your payment was submitted. We are waiting for billing confirmation before enabling your paid plan.</p><Link className="underline" to="/dashboard/settings?tab=billing">Open billing settings</Link></div>;
  return <main className="min-h-screen bg-slate-50 p-6 sm:p-10"><div className="mx-auto max-w-6xl space-y-6">
    <Link to="/dashboard"><img src="/sls_logo_wide_color.png" alt="SuperLocalSEO" className="h-10" /></Link>
    <h1 className="text-3xl font-bold">Choose your plan</h1>
    {billing?.status === 'trialing' && <p>{billing.trialDaysLeft ?? 0} days left in your Pro trial. No card required during your trial; subscribing starts paid service now.</p>}
    {billing?.pricingVersion === 'legacy' ? <p>Your existing billing is preserved. Contact support to change it.</p> : <>
    <PlanPicker plan={plan} interval={interval} onPlan={p => { setPlan(p); setIntent(null); setQuote(null); }} onInterval={v => { setInterval(v); setIntent(null); setQuote(null); }} disabled={busy} />
    {definition && <div className="rounded-xl border border-slate-200 bg-white p-6 space-y-4">
      <h2 className="font-semibold">{definition.name} · {money(interval === 'year' ? definition.annual : definition.monthly)}/{interval === 'year' ? 'year' : 'month'} before discounts</h2>
      {interval === 'year' && <p>Two months free: pay for ten months and get twelve months of access. Billed annually upfront.</p>}
      <label className="block">Promo code (optional)<input aria-label="Promo code" className="block border rounded-lg p-2 mt-2" value={promo} disabled={busy} onChange={e => { setPromo(e.target.value); setIntent(null); setQuote(null); }} /></label>
      {quote && <div role="status" className="rounded border p-4 space-y-2"><p className="font-semibold">Due today: {money(quote.amountDue)}</p><p>{quote.discount ?? 'No promo discount applied.'}</p><p>Expected next renewal: {money(quote.renewalAmount)}/{interval === 'year' ? 'year' : 'month'}. {quote.renewalDiscount ?? 'No discount at renewal.'}</p>{quote.amountDue === 0 && <p>Confirming activates your subscription without a card.</p>}</div>}
      {!intent && <button disabled={busy || !billing} onClick={() => void start()} className="rounded-lg bg-brand-500 text-white px-5 py-3 disabled:opacity-50">{busy ? 'Preparing checkout…' : quote ? `Confirm subscription · ${money(quote.amountDue)} due today` : 'Review total'}</button>}
      <p className="text-sm text-slate-500">Review the final discounted amount before paying. Your subscription starts only after you confirm the reviewed total, including when it is $0. Future renewals follow your plan and promo terms.</p>
      {intent && <><p className="font-semibold">Due today: {money(intent.amountDue)}</p><p>Expected next renewal: {money(quote?.renewalAmount ?? (interval === 'year' ? definition.annual : definition.monthly))}/{interval === 'year' ? 'year' : 'month'}. {quote?.renewalDiscount ?? 'No discount at renewal.'}</p>{stripe && intent.clientSecret && <Elements stripe={stripe} options={{ clientSecret: intent.clientSecret }} key={intent.clientSecret}><CheckoutForm onSuccess={() => setSuccess(true)} /></Elements>}</>}
      {error && <p role="alert" className="text-red-700">{error}</p>}
    </div>}</>}
  </div></main>;
}
export default function BillingPage() {
  if (new URLSearchParams(location.search).get('upgrade') === '1') return <Navigate to="/dashboard/settings?tab=billing&upgrade=1" replace />;
  return <SubscriptionCheckout />;
}
