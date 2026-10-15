import { Link } from 'react-router-dom';
import { usePlans, money, PlanKey, BillingInterval } from '../hooks/usePlans';
export function IntervalPicker({ value, onChange, disabled }: { value: BillingInterval; onChange: (v: BillingInterval) => void; disabled?: boolean }) {
  return <fieldset className="flex flex-wrap items-center gap-3"><legend className="text-sm font-medium mb-2">Billing interval</legend>{(['month', 'year'] as const).map(interval => <label key={interval} className="flex gap-2 items-center text-sm"><input type="radio" name="billing-interval" value={interval} checked={value === interval} disabled={disabled} onChange={() => onChange(interval)} />{interval === 'year' ? 'Annual — two months free' : 'Monthly'}</label>)}</fieldset>;
}
export function PlanPicker({ plan, interval, onPlan, onInterval, disabled = false, links = false }: { plan: PlanKey; interval: BillingInterval; onPlan: (p: PlanKey) => void; onInterval: (v: BillingInterval) => void; disabled?: boolean; links?: boolean }) {
  const { data, error } = usePlans(); const catalog = data?.data;
  if (!catalog) return <p role={error ? 'alert' : 'status'}>{error ? 'Pricing is unavailable. Please refresh to try again.' : 'Loading plans…'}</p>;
  return <div className="space-y-4"><IntervalPicker value={interval} onChange={onInterval} disabled={disabled} />
    {interval === 'year' && <p className="text-sm text-brand-700">Get twelve months for the price of ten—two months free. Billed annually upfront. The same saving applies to extra locations.</p>}
    <div className="grid gap-4 md:grid-cols-3">{(Object.keys(catalog.plans) as PlanKey[]).map(key => { const p = catalog.plans[key]; return <article key={key} className={`rounded-xl border-2 p-4 space-y-3 ${plan === key ? 'border-brand-500 bg-brand-50/30' : 'border-slate-200 bg-white'}`}>
      <h3 className="font-bold text-lg">{p.name} {key === 'pro' && <span className="block text-xs font-semibold text-brand-700">Most popular</span>}</h3>
      <p className="text-xl font-semibold">{money(interval === 'year' ? p.annual : p.monthly)}/{interval === 'year' ? 'year' : 'month'}</p>
      <p className="text-sm">{p.includedLocations} location{p.includedLocations > 1 ? 's' : ''} included{p.extraMonthly > 0 ? ` · ${money(interval === 'year' ? p.extraAnnual : p.extraMonthly)}/${interval === 'year' ? 'year' : 'month'} per extra location` : ' · upgrade to add locations'}</p>
      <ul className="space-y-2 text-sm text-slate-600">{p.features.map(f => <li key={f}>{f}</li>)}</ul>
      {links ? <Link className="inline-block rounded-lg bg-brand-500 text-white px-4 py-2" to={`/register?plan=${key}&interval=${interval}`}>Start {catalog.trialDays}-day free trial</Link> : <button type="button" disabled={disabled} onClick={() => onPlan(key)} aria-pressed={plan === key} className="rounded-lg border border-brand-500 px-4 py-2 text-brand-700 disabled:opacity-50">{plan === key ? 'Selected' : `Choose ${p.name}`}</button>}
    </article>; })}</div>
    <p className="text-sm text-slate-500">{catalog.trialDays}-day trial with Pro features. No card required. Choose your paid plan when ready. No setup fee.</p>
  </div>;
}
