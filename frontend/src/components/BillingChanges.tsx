import { useEffect, useMemo, useRef, useState } from 'react';
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js';
import { loadStripe } from '@stripe/stripe-js';
import { useSWRConfig } from 'swr';
import { apiFetch } from '../services/api';

type Action = 'upgrade' | 'add_location';
interface Preview { id: string; action: Action; amountDue: number; currency: string; monthlyAmount: number; needsCard: boolean; discount: string | null }
interface Result { status: string; clientSecret: string | null; publishableKey?: string }
const money = (cents: number, currency: string) => new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100);
async function request<T>(url: string, method = 'GET', body?: unknown): Promise<T> {
  const result = await apiFetch<{ success: boolean; data: T; error?: { message: string } }>(url, { method, ...(body ? { body: JSON.stringify(body) } : {}) });
  if (!result.success) throw new Error(result.error?.message || 'Billing request failed. Please try again.');
  return result.data;
}
function CardForm({ mode, onDone }: { mode: 'setup' | 'payment'; onDone: () => Promise<void> }) {
  const stripe = useStripe(); const elements = useElements();
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const lock = useRef(false);
  return <form className="space-y-3" onSubmit={async event => {
    event.preventDefault(); if (!stripe || !elements || lock.current) return;
    lock.current = true; setBusy(true); setError('');
    try {
      const options = { elements, confirmParams: { return_url: `${location.origin}/dashboard/settings?tab=billing` }, redirect: 'if_required' as const };
      const result = mode === 'setup' ? await stripe.confirmSetup(options) : await stripe.confirmPayment(options);
      if (result.error) throw new Error(result.error.message || 'Card confirmation failed.');
      await onDone();
    } catch (e) { setError((e as Error).message); } finally { lock.current = false; setBusy(false); }
  }}>
    <PaymentElement />
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    <button className="rounded-lg bg-brand-500 px-4 py-2 text-white disabled:opacity-50" disabled={!stripe || busy}>
      {busy ? 'Processing…' : mode === 'setup' ? 'Save card' : 'Confirm payment'}
    </button>
  </form>;
}
export function BillingChanges({ isLite, publishableKey, onLocations }: { isLite: boolean; publishableKey: string | null; onLocations: () => void }) {
  const { mutate } = useSWRConfig();
  const [action, setAction] = useState<Action | null>(() => new URLSearchParams(location.search).has('upgrade') ? 'upgrade' : null);
  const [promo, setPromo] = useState(''); const [quote, setQuote] = useState<Preview | null>(null);
  const [result, setResult] = useState<Result | null>(null); const [setupSecret, setSetupSecret] = useState<string | null>(null);
  const [cardSaved, setCardSaved] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const [success, setSuccess] = useState<Action | null>(null); const lock = useRef(false);
  const stripePromise = useMemo(() => publishableKey ? loadStripe(publishableKey) : null, [publishableKey]);
  useEffect(() => {
    let ignore = false;
    request<(Preview & Result) | null>('/billing/changes/pending').then(pending => {
      if (ignore || !pending) return;
      setAction(pending.action); setQuote(pending); setResult(pending);
    }).catch(e => { if (!ignore) setError(e.message); });
    return () => { ignore = true; };
  }, []);
  async function run(fn: () => Promise<void>) {
    if (lock.current) return; lock.current = true; setBusy(true); setError('');
    try { await fn(); } catch (e) { setError((e as Error).message); } finally { lock.current = false; setBusy(false); }
  }
  async function completed(next: Result) {
    setResult(next);
    if (next.status === 'succeeded') {
      setSuccess(action); setQuote(null); setAction(null); setSetupSecret(null); setResult(null);
      await Promise.all([mutate('/billing/status'), mutate('/clients'), mutate('/locations')]);
    } else if (next.status === 'failed') {
      setQuote(null); setResult(null); setError('This change was canceled or expired. You can request a new preview.');
    }
  }
  const pending = result?.status === 'payment_required' || result?.status === 'confirming';
  return <section aria-label="Change subscription" className="rounded-xl border border-brand-200 bg-brand-50/30 p-5 space-y-4">
    <div>
      <h3 className="font-semibold text-slate-900">{isLite ? 'Upgrade to Pro' : 'Additional locations'}</h3>
      <p className="text-sm text-slate-600 mt-1">{isLite
        ? 'Pro is $349/mo and adds competitor analysis, listings, geo-grid, audits, QR codes, and team access. No setup fee.'
        : 'Each additional location is $125/mo. Preview the prorated charge before adding capacity, then enter the location details.'}</p>
    </div>
    {success && <div role="status" className="rounded-lg bg-green-50 p-3 text-green-800 text-sm">
      {success === 'upgrade' ? 'You’re on Pro. Your new features are available now.' : 'Location capacity added. You can now enter the new location details.'}
      {success === 'add_location' && <button onClick={onLocations} className="block underline mt-2">Add location details</button>}
    </div>}
    {!action && <button onClick={() => { setAction(isLite ? 'upgrade' : 'add_location'); setSuccess(null); }} className="rounded-lg bg-brand-500 text-white px-4 py-2 text-sm font-semibold">
      {isLite ? 'Upgrade to Pro' : 'Add location ($125/mo)'}
    </button>}
    {action && <div className="space-y-4">
      {!pending && <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm text-slate-700">Promo code (optional)
          <input aria-label="Promo code" value={promo} onChange={e => { setPromo(e.target.value); setQuote(null); setSetupSecret(null); setCardSaved(false); }} disabled={busy} className="block rounded-lg border border-slate-300 px-3 py-2 mt-1" />
        </label>
        <button disabled={busy} onClick={() => void run(async () => {
          const next = await request<Preview>('/billing/changes/preview', 'POST', { action, promoCode: promo });
          setQuote(next); setResult(null); setSetupSecret(null); setCardSaved(false);
        })} className="rounded-lg border border-brand-400 px-4 py-2 text-brand-700 disabled:opacity-50">{busy ? 'Loading…' : 'Preview change'}</button>
      </div>}
      {quote && <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-3">
        <dl className="space-y-2 text-sm">
          <div className="flex justify-between gap-4"><dt>Prorated amount due today</dt><dd data-testid="change-due-today" className="font-semibold">{money(quote.amountDue, quote.currency)}</dd></div>
          <div className="flex justify-between gap-4"><dt>New monthly price before discounts</dt><dd className="font-semibold">{money(quote.monthlyAmount, quote.currency)}/mo</dd></div>
        </dl>
        {quote.discount && <p className="text-sm text-green-700">{quote.discount}</p>}
        {quote.amountDue === 0 && <p className="text-sm text-green-700">No payment or card is needed today.</p>}
        {!pending && <p className="text-xs text-slate-500">This preview is valid for 15 minutes. Your subscription changes only when you confirm. Future invoices follow your plan and discount terms.</p>}
        {!pending && quote.needsCard && !cardSaved && <div className="space-y-3">
          <p className="text-sm text-slate-600">Add a card for today’s payment and future renewals. Saving it does not confirm this change.</p>
          {!setupSecret && <button disabled={busy} className="underline text-brand-700" onClick={() => void run(async () => {
            const setup = await request<{ clientSecret: string }>(`/billing/changes/${quote.id}/setup`, 'POST'); setSetupSecret(setup.clientSecret);
          })}>Add payment card</button>}
          {setupSecret && stripePromise && <Elements stripe={stripePromise} options={{ clientSecret: setupSecret }} key={setupSecret}>
            <CardForm mode="setup" onDone={async () => { setCardSaved(true); setSetupSecret(null); }} />
          </Elements>}
        </div>}
        {cardSaved && <p className="text-sm text-green-700">Card saved. Review the amount and confirm below.</p>}
        {(!pending || result?.status === 'confirming') && <button disabled={busy || (!pending && quote.needsCard && !cardSaved)} className="rounded-lg bg-brand-500 px-4 py-2 text-white disabled:opacity-50" onClick={() => void run(async () => {
          await completed(await request<Result>(`/billing/changes/${quote.id}/confirm`, 'POST'));
        })}>{busy ? 'Confirming…' : result?.status === 'confirming' ? 'Retry confirmation' : `Confirm ${action === 'upgrade' ? 'upgrade' : 'additional location'} · ${money(quote.amountDue, quote.currency)} today`}</button>}
        {result?.status === 'payment_required' && <div className="space-y-3">
          <p className="text-sm text-slate-600">Complete payment to apply this change. Your current plan remains available.</p>
          {result.clientSecret && stripePromise && <Elements stripe={stripePromise} options={{ clientSecret: result.clientSecret }} key={result.clientSecret}>
            <CardForm mode="payment" onDone={async () => { await completed(await request<Result>(`/billing/changes/${quote.id}`)); }} />
          </Elements>}
          <button className="underline text-brand-700" disabled={busy} onClick={() => void run(async () => completed(await request<Result>(`/billing/changes/${quote.id}`)))}>Check payment status</button>
          <button className="block text-sm text-slate-600 underline" disabled={busy} onClick={() => void run(async () => completed(await request<Result>(`/billing/changes/${quote.id}`, 'DELETE')))}>Cancel this change</button>
        </div>}
      </div>}
      {!pending && <button disabled={busy} onClick={() => { setAction(null); setQuote(null); setSetupSecret(null); setError(''); }} className="text-sm text-slate-500 underline">Cancel</button>}
    </div>}
    {error && <p role="alert" className="rounded-lg bg-red-50 text-red-700 p-3 text-sm">{error}</p>}
  </section>;
}
