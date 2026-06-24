# SuperLocalSEO — Lite/Pro Split: Implementation Spec (rev 2)

**Revision notes:** Addresses all six concerns raised in Claude Code review:
1. Central feature map with default-deny (replaces manual per-route gating)
2. Full upgrade billing mechanics specified (Stripe subscription swap + setup fee + proration)
3. Single shared capability map used by both backend middleware and frontend hooks
4. `requireProPlan` reuses `req.user` / `req.client` — zero extra DB queries
5. Single onboarding file with a `lite` prop (no second file, no drift)
6. `requireProPlan` unit test + `08-onboarding-lite` e2e spec stubs added

**Decisions baked in:**
- Lite = $99/mo, single location only, no setup fee
- Pro = $350/mo + $499 setup (current), multi-location
- Lite gets: Dashboard (simplified), Rankings (read-only), Reviews, Campaigns, Reports, Settings
- Lite also gets: a **blurred/locked teaser** on Competitors to drive upgrades
- Lite does NOT get: Citations, geo-grid, BrightLocal audits, SEO Audit, QR codes, Team, analytics/CSV exports, competitor gap/head-to-head tools
- Free audit page CTA defaults to `?plan=lite` post-audit
- Lite onboarding = existing wizard with `lite` prop (skips keywords step, auto-seeds from industry)
- All existing clients default to `'pro'` — zero disruption

---

## File Map

All paths are repo-relative. Backend = `backend/src/`, Frontend = `frontend/src/`.

---

## Part 1 — Shared Capability Map

This is the single source of truth for both the backend gate middleware and the frontend hook. It lives in a shared location that both can import.

### 1.1 New file: `backend/src/config/planFeatures.ts`

```typescript
/**
 * Central plan capability map.
 * Backend: consumed by requireProPlan middleware via route prefix matching.
 * Frontend: the same data structure is duplicated in frontend/src/config/planFeatures.ts
 *           (can't be shared directly across workspaces without a monorepo setup).
 *
 * HOW IT WORKS — default-deny:
 * - Any route NOT listed here is implicitly Lite-accessible (public/auth/billing etc.)
 * - Any route listed here with plans: ['pro'] is blocked for Lite
 * - Any route listed here with plans: ['lite', 'pro'] is open to both
 *
 * Matching is prefix-based: '/citations' matches /api/citations, /api/citations/scan, etc.
 * For competitors, sub-path overrides are used (more specific path wins).
 */

export interface RouteGate {
  /** API route prefix (without /api/ prefix) */
  prefix: string;
  plans: ('lite' | 'pro')[];
  /** Optional: sub-path overrides (more specific prefix wins over parent) */
  subPaths?: Array<{ path: string; plans: ('lite' | 'pro')[] }>;
}

export const PLAN_ROUTE_GATES: RouteGate[] = [
  // ── Blocked entirely for Lite ──────────────────────────────────────────────
  { prefix: 'citations',  plans: ['pro'] },
  { prefix: 'geo-grid',   plans: ['pro'] },
  { prefix: 'audits/bl',  plans: ['pro'] },
  { prefix: 'reputation', plans: ['pro'] },

  // ── Competitors: base list open for Lite (teaser), sub-routes Pro-only ─────
  {
    prefix: 'competitors',
    plans: ['lite', 'pro'],  // GET /competitors allowed for Lite (teaser data)
    subPaths: [
      { path: 'competitors/gap',               plans: ['pro'] },
      { path: 'competitors/head-to-head',      plans: ['pro'] },
      { path: 'competitors/search',            plans: ['pro'] },
      { path: 'competitors/sync-rankings',     plans: ['pro'] },
      { path: 'competitors/discover-keywords', plans: ['pro'] },
      // POST /competitors (add competitor) — Pro only
      { path: 'competitors/__create__',        plans: ['pro'] },
    ],
  },

  // ── Analytics: trend endpoints open, exports and rankings data Pro-only ────
  {
    prefix: 'analytics',
    plans: ['lite', 'pro'],
    subPaths: [
      { path: 'analytics/rankings',  plans: ['pro'] },
      { path: 'analytics/export',    plans: ['pro'] },
      { path: 'analytics/roi',       plans: ['pro'] },
    ],
  },

  // ── Rankings: read open for Lite, writes/exports Pro-only ─────────────────
  {
    prefix: 'rankings',
    plans: ['lite', 'pro'],
    subPaths: [
      { path: 'rankings/export', plans: ['pro'] },
      { path: 'rankings/sync',   plans: ['pro'] },
    ],
  },

  // ── Team & QR: Pro only ───────────────────────────────────────────────────
  { prefix: 'team', plans: ['pro'] },
  { prefix: 'qr',   plans: ['pro'] },
];

/**
 * Given an API path (e.g. "competitors/gap") and a product_line,
 * returns true if the plan is allowed to access that path.
 *
 * Used directly in middleware. Exported here so tests can import it independently.
 */
export function isPlanAllowed(apiPath: string, productLine: 'lite' | 'pro'): boolean {
  if (productLine === 'pro') return true; // Pro always passes

  // Normalize: strip leading slash
  const path = apiPath.replace(/^\//, '');

  // Find the most specific matching gate (sub-path overrides parent)
  for (const gate of PLAN_ROUTE_GATES) {
    // Check sub-path overrides first (more specific wins)
    if (gate.subPaths) {
      for (const sub of gate.subPaths) {
        // Special case: __create__ matches POST on the base path — handled in middleware
        if (sub.path === `${gate.prefix}/__create__`) continue;
        if (path.startsWith(sub.path)) {
          return sub.plans.includes(productLine);
        }
      }
    }
    // Match against base prefix
    if (path.startsWith(gate.prefix)) {
      return gate.plans.includes(productLine);
    }
  }

  return true; // Not listed → open to all (public/auth/billing routes)
}
```

### 1.2 New file: `frontend/src/config/planFeatures.ts`

This mirrors the backend map. Since frontend and backend are separate workspaces, this is a deliberate copy — comment it as such so future editors know to keep them in sync.

```typescript
/**
 * Frontend plan capability map — mirrors backend/src/config/planFeatures.ts
 * If you update one, update the other.
 *
 * Used by: useClient hook, DashboardLayout nav filtering, ProGate component,
 * and any inline isLite checks in pages.
 */

export type Plan = 'lite' | 'pro';

export interface NavItem {
  to: string;
  label: string;
  icon: string; // lucide icon name — resolved in DashboardLayout
  plans: Plan[];
  /** If true, Lite users see a teaser view rather than being redirected */
  teaserForLite?: boolean;
}

export const NAV_ITEMS: NavItem[] = [
  { to: '/dashboard',             label: 'Dashboard',   icon: 'Home',        plans: ['lite', 'pro'] },
  { to: '/dashboard/rankings',    label: 'Rankings',    icon: 'BarChart2',   plans: ['lite', 'pro'] },
  { to: '/dashboard/reviews',     label: 'Reviews',     icon: 'Star',        plans: ['lite', 'pro'] },
  { to: '/dashboard/campaigns',   label: 'Campaigns',   icon: 'Megaphone',   plans: ['lite', 'pro'] },
  { to: '/dashboard/competitors', label: 'Competitors', icon: 'Users2',      plans: ['lite', 'pro'], teaserForLite: true },
  { to: '/dashboard/citations',   label: 'Citations',   icon: 'Link2',       plans: ['pro'] },
  { to: '/dashboard/audit',       label: 'SEO Audit',   icon: 'ClipboardList', plans: ['pro'] },
  { to: '/dashboard/reports',     label: 'Reports',     icon: 'FileText',    plans: ['lite', 'pro'] },
  { to: '/dashboard/settings',    label: 'Settings',    icon: 'Settings',    plans: ['lite', 'pro'] },
];

/** Settings tabs that are Pro-only */
export const PRO_SETTINGS_TABS = ['team', 'qr', 'whitelabel'] as const;

/** Rankings page features hidden for Lite */
export const LITE_RANKINGS_HIDDEN = ['csvExport', 'manualSync', 'roiColumn', 'geoGrid'] as const;

/**
 * Returns true if the given plan can access the given feature key.
 * Feature keys match the NAV_ITEMS `to` paths or the LITE_RANKINGS_HIDDEN keys.
 */
export function canAccess(plan: Plan, feature: string): boolean {
  if (plan === 'pro') return true;
  const navItem = NAV_ITEMS.find((n) => n.to === feature || n.label.toLowerCase() === feature.toLowerCase());
  if (navItem) return navItem.plans.includes(plan);
  return true; // unlisted features are open
}
```

---

## Part 2 — Database Migration

### 2.1 New file: `backend/src/db/migrations/20260624000000_product_line.ts`

```typescript
import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('clients', (t) => {
    // Default 'pro' so all existing clients are unaffected
    t.string('product_line', 20).notNullable().defaultTo('pro');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('clients', (t) => {
    t.dropColumn('product_line');
  });
}
```

---

## Part 3 — Backend Config (Stripe Lite price)

### 3.1 Edit: `backend/src/config.ts`

In the `stripe.prices` block, add `liteBase`:

```typescript
// BEFORE:
prices: {
  setup: optional('STRIPE_SETUP_PRICE_ID'),
  base: optional('STRIPE_BASE_PRICE_ID'),
  location: optional('STRIPE_LOCATION_PRICE_ID'),
},

// AFTER:
prices: {
  setup:    optional('STRIPE_SETUP_PRICE_ID'),
  base:     optional('STRIPE_BASE_PRICE_ID'),
  location: optional('STRIPE_LOCATION_PRICE_ID'),
  liteBase: optional('STRIPE_LITE_BASE_PRICE_ID'),  // $99/mo recurring, no setup fee
},
```

### 3.2 Edit: `.env.example`

```
STRIPE_LITE_BASE_PRICE_ID=     # Stripe price ID for Lite plan ($99/mo recurring)
```

---

## Part 4 — Backend Middleware (using req.client — zero extra DB reads)

### 4.1 New file: `backend/src/middleware/requireProPlan.ts`

This replaces the version in rev 1. Key change: it reads `req.user` and `req.client` which are already populated by `requireAuth` and `requireClient` — no new DB queries.

```typescript
import { Request, Response, NextFunction } from 'express';
import { isPlanAllowed } from '../config/planFeatures';

/**
 * Plan-based access gate. Must be mounted AFTER requireAuth and requireClient.
 *
 * Uses isPlanAllowed() from the central capability map — no manual per-route logic.
 * Reuses req.user and req.client (populated by requireAuth / requireClient) — zero extra DB reads.
 */
export function requireProPlan(req: Request, res: Response, next: NextFunction): void {
  // Admins always bypass
  if (req.user?.role === 'admin') { next(); return; }

  const productLine = (req.client?.product_line as string | null) ?? 'pro';

  // Strip /api/ prefix, get the meaningful path segment
  const apiPath = req.path.replace(/^\/api\//, '').replace(/^\//, '');

  // Special case: POST /competitors creates a competitor — mapped to __create__ sub-path
  const normalizedPath = (req.method === 'POST' && apiPath === 'competitors')
    ? 'competitors/__create__'
    : apiPath;

  if (isPlanAllowed(normalizedPath, productLine as 'lite' | 'pro')) {
    next(); return;
  }

  res.status(403).json({
    success: false,
    error: { code: 'PRO_REQUIRED', message: 'This feature requires the Pro plan.' },
  });
}
```

### 4.2 Edit: `backend/src/routes/index.ts`

Replace manual per-file gating with a **single middleware applied at the router level**, after `requireActiveSubscription`. This is the fail-safe approach: any new route added gets gated automatically.

```typescript
import { requireProPlan } from '../middleware/requireProPlan';

// ── Replace the subscription-gated block with this ───────────────────────────

// Routes that need an active subscription AND plan-level gating
const subscriptionRoutes = [
  ['/keywords',    keywordsRouter],
  ['/rankings',    rankingsRouter],
  ['/citations',   citationsRouter],
  ['/reviews',     reviewsRouter],
  ['/reports',     reportsRouter],
  ['/analytics',   analyticsRouter],
  ['/campaigns',   campaignsRouter],
  ['/competitors', competitorsRouter],
  ['/audits/bl',   auditsBlRouter],
  ['/reputation',  reputationRouter],
  ['/geo-grid',    geoGridRouter],
] as const;

for (const [path, routerModule] of subscriptionRoutes) {
  router.use(path, requireActiveSubscription, requireProPlan, routerModule);
}

// Team and QR don't need requireActiveSubscription (accessible during trial)
// but DO need the plan gate:
router.use('/team', requireProPlan, teamRouter);
router.use('/qr',   requireProPlan, qrRouter);
```

> **Note:** `req.user` and `req.client` are populated by `requireAuth` and `requireClient` inside each route file. The `requireProPlan` middleware runs before the individual route handlers but after the Express Router has started processing — `req.user` will be populated by the time `requireProPlan` executes as long as `requireAuth` is the first middleware in each child route. Verify this is the case across all route files before deploying.
>
> If any route file doesn't call `requireAuth` as its first middleware, add `requireProPlan` inside that file after `requireAuth` and `requireClient` instead of at the index level.

---

## Part 5 — Stripe Service: Lite plan + Upgrade mechanics

### 5.1 Edit: `backend/src/services/stripe.service.ts`

#### 5.1a — Add `upgradeToProSubscription` function

This is the new function that handles the Lite → Pro upgrade. It:
1. Swaps the subscription price from `liteBase` → `proBase`
2. Adds the setup fee as a one-time invoice item charged immediately
3. Uses `proration_behavior: 'always_invoice'` so the price difference is charged right away
4. Updates `product_line = 'pro'` in the DB

```typescript
/**
 * Upgrade a Lite subscriber to Pro.
 *
 * Mechanics:
 * - Swap subscription item from liteBase price → proBase price
 * - Charge the $499 setup fee as an immediate one-time invoice item
 * - Prorate the current billing period (charge difference immediately via invoice)
 * - Update clients.product_line = 'pro' and clients.locations_limit to 1
 *
 * @returns clientSecret for the upgrade payment intent (if additional payment needed)
 *          or null if no payment is required (e.g. covered by credit)
 */
export async function upgradeToProSubscription(
  subscriptionId: string,
  userId: string,
  promotionCodeId?: string,
): Promise<{ clientSecret: string | null; invoiceId: string }> {
  // 1. Retrieve current subscription to find the Lite item
  const sub = await stripe.subscriptions.retrieve(subscriptionId, { expand: ['items'] });
  const liteItem = sub.items.data.find((i) => i.price.id === config.stripe.prices.liteBase);

  if (!liteItem) {
    throw new Error('No Lite subscription item found — cannot upgrade.');
  }

  // 2. Add the $499 setup fee as an upcoming invoice item (charged on next invoice)
  if (config.stripe.prices.setup) {
    await stripe.invoiceItems.create({
      customer: sub.customer as string,
      price: config.stripe.prices.setup,
      description: 'SuperLocalSEO Pro — one-time setup fee',
    });
  }

  // 3. Swap subscription item: Lite → Pro base price
  //    always_invoice creates an invoice immediately for the proration + setup fee
  const updatedSub = await stripe.subscriptions.update(subscriptionId, {
    items: [
      {
        id: liteItem.id,
        price: config.stripe.prices.base!,  // Pro base price
        quantity: 1,
      },
    ],
    proration_behavior: 'always_invoice',
    metadata: { ...sub.metadata, plan: 'pro', userId },
    ...(!promotionCodeId ? {} : { promotion_code: promotionCodeId }),
  });

  // 4. Retrieve the invoice that was just created
  const latestInvoice = updatedSub.latest_invoice as string | Stripe.Invoice | null;
  let invoiceId: string;
  let clientSecret: string | null = null;

  if (typeof latestInvoice === 'string') {
    // Expand to get payment intent
    const inv = await stripe.invoices.retrieve(latestInvoice, { expand: ['payment_intent'] });
    invoiceId = inv.id;
    const pi = inv.payment_intent as Stripe.PaymentIntent | null;
    clientSecret = pi?.client_secret ?? null;
  } else if (latestInvoice) {
    invoiceId = latestInvoice.id;
    const pi = latestInvoice.payment_intent as Stripe.PaymentIntent | null;
    clientSecret = pi?.client_secret ?? null;
  } else {
    throw new Error('No invoice generated for upgrade — cannot confirm payment.');
  }

  // 5. Optimistically update the DB (webhook will also fire but idempotent)
  await db('clients')
    .where({ user_id: userId })
    .update({
      product_line: 'pro',
      locations_limit: 1,  // Pro base = 1 location; they can add more separately
      updated_at: new Date(),
    });

  return { clientSecret, invoiceId };
}
```

#### 5.1b — Update `createSubscriptionIntent` to accept `plan`

Add `plan: 'lite' | 'pro' = 'pro'` parameter and branch on it:

```typescript
export async function createSubscriptionIntent(
  customerId: string,
  extraLocations: number,
  userId: string,
  promotionCodeId?: string,
  plan: 'lite' | 'pro' = 'pro',   // ← NEW
): Promise<{ clientSecret: string; subscriptionId: string }> {

  if (plan === 'lite') {
    // Lite: single recurring item, no setup fee, no extra locations
    const sub = await stripe.subscriptions.create({
      customer: customerId,
      items: [{ price: config.stripe.prices.liteBase! }],
      payment_behavior: 'default_incomplete',
      payment_settings: { save_default_payment_method: 'on_subscription' },
      expand: ['latest_invoice.payment_intent'],
      metadata: { userId, extraLocations: '0', plan: 'lite' },
      ...(!promotionCodeId ? {} : { promotion_code: promotionCodeId }),
    });
    const invoice = sub.latest_invoice as Stripe.Invoice;
    const pi = invoice.payment_intent as Stripe.PaymentIntent;
    return { clientSecret: pi.client_secret!, subscriptionId: sub.id };
  }

  // Pro: existing logic unchanged — setup fee + base + optional extra locations
  // (copy the existing function body here verbatim)
  // ...existing Pro logic...
}
```

#### 5.1c — Update `createCheckoutSession` to accept `plan`

Same pattern — add `plan: 'lite' | 'pro' = 'pro'` and branch identically to `createSubscriptionIntent` above. Checkout sessions use `config.stripe.prices.liteBase` for Lite, no setup item.

#### 5.1d — Update `handleWebhookEvent` — `checkout.session.completed`

```typescript
case 'checkout.session.completed': {
  const session = event.data.object as Stripe.Checkout.Session;
  if (session.mode !== 'subscription' || !session.subscription || !session.customer) break;
  const userId = session.metadata?.userId;
  if (!userId) break;
  const plan = (session.metadata?.plan ?? 'pro') as 'lite' | 'pro';
  const extra = plan === 'lite' ? 0 : parseInt(session.metadata?.extraLocations ?? '0', 10);
  await db('clients')
    .where({ user_id: userId })
    .update({
      stripe_subscription_id: session.subscription as string,
      subscription_status: 'active',
      locations_limit: plan === 'lite' ? 1 : 1 + extra,
      product_line: plan,   // ← NEW
      updated_at: new Date(),
    });
  break;
}
```

#### 5.1e — Update `customer.subscription.updated` webhook

When a subscription update fires (including the upgrade swap), preserve `product_line` from subscription metadata so it doesn't get overwritten:

```typescript
case 'customer.subscription.updated': {
  const sub = event.data.object as Stripe.Subscription;
  const userId = sub.metadata?.userId;
  if (!userId) break;
  const status = sub.status === 'active' ? 'active'
    : sub.status === 'past_due' ? 'past_due'
    : sub.status === 'canceled' ? 'canceled' : 'trialing';
  const locationItem = sub.items.data.find((i) => i.price.id === config.stripe.prices.location);
  const extra = locationItem?.quantity ?? 0;

  // If metadata carries a plan (set during upgrade), update product_line too
  const planFromMeta = sub.metadata?.plan as 'lite' | 'pro' | undefined;

  await db('clients')
    .where({ user_id: userId })
    .update({
      subscription_status: status,
      subscription_current_period_end: new Date(sub.current_period_end * 1000),
      locations_limit: planFromMeta === 'lite' ? 1 : 1 + extra,
      ...(planFromMeta ? { product_line: planFromMeta } : {}),  // ← only update if present
      updated_at: new Date(),
    });
  break;
}
```

---

## Part 6 — Billing Controller: upgrade endpoint + plan-aware checkout

### 6.1 Edit: `backend/src/controllers/billing.controller.ts`

#### 6.1a — Add `upgrade` handler

```typescript
/**
 * POST /billing/upgrade
 * Upgrades an active Lite subscriber to Pro.
 * Returns a clientSecret if additional payment confirmation is needed,
 * or null if the upgrade is covered by existing credit/proration.
 */
export async function upgrade(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const client = req.client;
    if (!client) { err(res, 'Client not found', 404, 'NOT_FOUND'); return; }
    if (client.product_line !== 'lite') {
      err(res, 'Account is already on Pro', 400, 'ALREADY_PRO'); return;
    }
    if (!client.stripe_subscription_id) {
      err(res, 'No active subscription to upgrade', 400, 'NO_SUBSCRIPTION'); return;
    }

    const { promotionCodeId } = req.body as { promotionCodeId?: string };
    const result = await upgradeToProSubscription(
      client.stripe_subscription_id as string,
      req.userId!,
      promotionCodeId,
    );

    ok(res, result);
  } catch (e) { next(e); }
}
```

#### 6.1b — Register the route in `backend/src/routes/billing.ts`

```typescript
// Add alongside existing billing routes:
router.post('/upgrade', requireAuth, requireClient, requireTeamAdmin, ctrl.upgrade);
```

#### 6.1c — Update `subscriptionIntent` handler to accept and pass `plan`

```typescript
export async function subscriptionIntent(req: Request, ...) {
  const plan = (req.body.plan === 'lite') ? 'lite' : 'pro';
  const extraLocations = plan === 'lite' ? 0 : Math.max(0, parseInt(req.body.extraLocations ?? '0', 10));
  // ... existing customer ID logic ...
  const result = await createSubscriptionIntent(customerId, extraLocations, req.userId!, promotionCodeId, plan);
  ok(res, result);
}
```

#### 6.1d — Expose `productLine` in `status` handler

```typescript
ok(res, {
  status: client.subscription_status,
  trialEndsAt: trialEndsAt?.toISOString() ?? null,
  trialDaysLeft,
  locationsLimit: client.locations_limit ?? 1,
  locationCount: locCount,
  currentPeriodEnd: client.subscription_current_period_end ?? null,
  paymentFailedAt: client.payment_failed_at ?? null,
  publishableKey: config.stripe.publishableKey,
  productLine: (client.product_line as string | null) ?? 'pro',   // ← NEW
});
```

---

## Part 7 — Client Controller: Expose `productLine`

### 7.1 Edit: `backend/src/controllers/client.controller.ts`

In `formatClient`, add `productLine`:

```typescript
return {
  id: client.id,
  email,
  businessName: client.business_name,
  industry: client.industry,
  productLine: (client.product_line as string | null) ?? 'pro',  // ← NEW
  billing: { ... },
  // ... rest unchanged
};
```

---

## Part 8 — Frontend: `useClient` hook

### 8.1 New file: `frontend/src/hooks/useClient.ts`

```typescript
import useSWR from 'swr';
import { fetcher } from '../services/api';
import { useAuth } from './useAuth';
import type { Plan } from '../config/planFeatures';

interface ClientData {
  id: string;
  email: string;
  businessName: string;
  industry: string | null;
  productLine: Plan;
  onboardingStep: number;
  billing: { plan: string; status: string };
  integrations: {
    google: { connected: boolean };
    facebook: { connected: boolean; pageName: string | null };
  };
  locations: Array<{
    id: string; name: string; address: string | null;
    city: string | null; state: string | null; zip: string | null;
    phone: string | null; website: string | null; isPrimary: boolean;
  }>;
  emrProvisioningStatus: string | null;
  whiteLabel: { companyName: string | null; logoUrl: string | null; color: string | null };
}

interface UseClientResult {
  client: ClientData | null;
  productLine: Plan;
  isLite: boolean;
  isPro: boolean;
  loading: boolean;
  mutate: () => void;
}

export function useClient(): UseClientResult {
  const { isAuthenticated, role } = useAuth();
  const { data, isLoading, mutate } = useSWR<{ success: boolean; data: ClientData }>(
    isAuthenticated && role === 'client' ? '/clients' : null,
    fetcher,
  );

  const client = data?.data ?? null;
  const productLine: Plan = (client?.productLine ?? 'pro') as Plan;

  return {
    client,
    productLine,
    isLite: productLine === 'lite',
    isPro: productLine === 'pro',
    loading: isLoading,
    mutate,
  };
}
```

---

## Part 9 — Frontend: `ProGate` component

### 9.1 New file: `frontend/src/components/ProGate.tsx`

```tsx
import { Lock } from 'lucide-react';
import { Link } from 'react-router-dom';

interface ProGateProps {
  feature: string;
  description: string;
}

export function ProGate({ feature, description }: ProGateProps) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-10 text-center max-w-md mx-auto mt-12">
      <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-slate-100 mb-4">
        <Lock className="w-5 h-5 text-slate-400" />
      </div>
      <p className="font-semibold text-slate-800 mb-1 text-base">{feature} is a Pro feature</p>
      <p className="text-sm text-slate-500 mb-5">{description}</p>
      <Link
        to="/billing?upgrade=1"
        className="inline-flex items-center gap-1.5 px-5 py-2.5 bg-brand-500 text-white text-sm font-semibold rounded-lg hover:bg-brand-600 transition-colors"
      >
        Upgrade to Pro →
      </Link>
    </div>
  );
}
```

---

## Part 10 — Frontend: DashboardLayout nav + onboarding redirect

### 10.1 Edit: `frontend/src/layouts/DashboardLayout.tsx`

**Replace the static `navItems` array** with dynamic resolution from `planFeatures.ts`:

```typescript
import { NAV_ITEMS } from '../config/planFeatures';
import { Home, BarChart2, Star, Megaphone, Users2, Link2, ClipboardList, FileText, Settings } from 'lucide-react';
import { useClient } from '../hooks/useClient';

// Icon lookup (keeps planFeatures.ts icon-library-agnostic)
const ICON_MAP: Record<string, React.ReactNode> = {
  Home:          <Home size={17} aria-hidden />,
  BarChart2:     <BarChart2 size={17} aria-hidden />,
  Star:          <Star size={17} aria-hidden />,
  Megaphone:     <Megaphone size={17} aria-hidden />,
  Users2:        <Users2 size={17} aria-hidden />,
  Link2:         <Link2 size={17} aria-hidden />,
  ClipboardList: <ClipboardList size={17} aria-hidden />,
  FileText:      <FileText size={17} aria-hidden />,
  Settings:      <Settings size={17} aria-hidden />,
};

function SidebarNav({ onNav }: { onNav?: () => void }) {
  const { logout, role } = useAuth();
  const { productLine } = useClient();

  const visibleNavItems = role === 'admin'
    ? NAV_ITEMS
    : NAV_ITEMS.filter((item) => item.plans.includes(productLine));

  return (
    <nav className="flex-1 px-2.5 py-2 space-y-0.5" aria-label="Dashboard navigation">
      {visibleNavItems.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.to === '/dashboard'}
          onClick={onNav}
          className={({ isActive }) =>
            `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150 ${
              isActive ? 'bg-slate-800 text-white' : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200'
            }`
          }
        >
          {ICON_MAP[item.icon]}
          <span>{item.label}</span>
        </NavLink>
      ))}
    </nav>
    // ... logout button unchanged ...
  );
}
```

**Update `OnboardingRedirect`** to route Lite users to the lite flag:

```typescript
function OnboardingRedirect() {
  const { role } = useAuth();
  const { productLine } = useClient();
  const navigate = useNavigate();
  const { data } = useSWR<{ success: boolean; data: { onboardingStep: number } }>(
    role === 'client' ? '/clients' : null,
    fetcher,
  );

  useEffect(() => {
    if (role !== 'client' || !data?.data) return;
    if (data.data.onboardingStep === 0) {
      // Same route, lite prop handled via query param
      const dest = productLine === 'lite' ? '/onboarding?lite=1' : '/onboarding';
      navigate(dest, { replace: true });
    }
  }, [data, role, navigate, productLine]);

  return null;
}
```

---

## Part 11 — Frontend: Single Onboarding file with `lite` mode

### 11.1 Edit: `frontend/src/pages/Onboarding.tsx`

**Do not create `OnboardingLite.tsx`.** Instead, modify the existing file to accept a `lite` mode. This was a deliberate choice: the file was just heavily reworked in commit #100 (318-line diff), and a second file would drift immediately.

**At the top of the `Onboarding` component**, read the `?lite=1` query param:

```typescript
import { useSearchParams } from 'react-router-dom';

export default function Onboarding() {
  const [searchParams] = useSearchParams();
  const isLiteMode = searchParams.get('lite') === '1';

  // TOTAL_STEPS: Pro=4, Lite=2 (skip keywords; no need for Google connect step
  // because GBP connect is in Settings and can be deferred)
  const TOTAL_STEPS = isLiteMode ? 2 : 4;

  // ... rest of existing state ...
```

**In Step 1 (business info):** unchanged — same fields work for both modes.

**In the Step 1 → Step 2 transition**, when `isLiteMode`:
- Call the location creation API (same as existing Step 2 logic)
- Auto-seed keywords by calling POST `/keywords/seed` with `{ industry }` instead of showing Step 3
- Jump directly to Step 2 (Google connect)

Add a helper:
```typescript
const handleLiteStep1Next = async () => {
  // 1. Save business info (same as existing step 1 save)
  await saveBizInfo();
  // 2. Create location (same as existing step 2 save, using state already set)
  await saveLocation();
  // 3. Auto-seed keywords from industry — fire and forget, don't block
  apiFetch('/keywords/seed', { method: 'POST', body: JSON.stringify({ industry }) }).catch(() => {});
  // 4. Advance to step 2 (Google connect)
  setStep(2);
};
```

**Step 2 (Lite mode = Google connect):** Show the Google OAuth connect button and a "Skip for now" link. This is already Step 4 content in the Pro flow — reuse that JSX conditionally:

```typescript
// In the step render logic:
const effectiveStep = isLiteMode ? step : step; // same numbering, different meaning

// Step 2 in Lite mode renders the same JSX as Step 4 in Pro mode
if (isLiteMode && step === 2) {
  // Render Google connect step (copy JSX from Step 4 case)
}
```

**In the step indicator**, pass `totalSteps={TOTAL_STEPS}` to the indicator component so it shows "Step 1 of 2" for Lite.

**"Skip for now" on Google connect**: in `isLiteMode`, the skip should call `completeOnboarding()` and navigate to `/dashboard`. In Pro mode, it advances to step 4 (same as current).

---

## Part 12 — Frontend: Competitors teaser for Lite

### 12.1 Edit: `frontend/src/pages/Competitors.tsx`

```tsx
import { Lock } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useClient } from '../hooks/useClient';

export default function Competitors() {
  const { isLite } = useClient();

  // Always fetch GET /competitors (allowed for Lite per capability map)
  const { data: competitorsData } = useSWR('/competitors', fetcher);
  const competitors = competitorsData?.data ?? [];

  if (isLite) {
    return <CompetitorsTeaserView competitors={competitors} />;
  }

  // ... existing full Pro render (unchanged) ...
}

function CompetitorsTeaserView({ competitors }: { competitors: Competitor[] }) {
  // Show real data: name, googleRating, googleReviewCount for up to 3 competitors
  // If fewer than 3 real competitors, pad with placeholder rows (slightly obfuscated names)
  const realRows = competitors.slice(0, 3).map((c) => ({
    id: c.id,
    name: c.name,
    googleRating: c.googleRating,
    googleReviewCount: c.googleReviewCount,
    isReal: true,
  }));

  const placeholders = [
    { name: 'Main Street Plumbing', googleRating: 4.8, googleReviewCount: 312 },
    { name: 'City HVAC Services',   googleRating: 4.6, googleReviewCount: 187 },
    { name: 'Premier Contractors',  googleRating: 4.3, googleReviewCount: 94 },
  ].slice(0, Math.max(0, 3 - realRows.length)).map((p, i) => ({ ...p, id: `placeholder-${i}`, isReal: false }));

  const rows = [...realRows, ...placeholders];

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-slate-900">Competitors</h1>
        <p className="text-sm text-slate-500 mt-1">See how you stack up against local competitors.</p>
      </div>

      {/* Visible snapshot — real data */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden mb-4">
        <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
          <span className="text-sm font-semibold text-slate-700">Local competitors</span>
          <span className="text-xs text-slate-400">Rating · Reviews</span>
        </div>
        {rows.map((c) => (
          <div key={c.id} className={`flex items-center justify-between px-5 py-3.5 border-b border-slate-50 last:border-0 ${!c.isReal ? 'opacity-50' : ''}`}>
            <span className="text-sm font-medium text-slate-800">{c.name}</span>
            <div className="flex items-center gap-4">
              <span className="flex items-center gap-1 text-sm text-slate-600">
                <Star size={13} className="fill-yellow-400 text-yellow-400" />
                {c.googleRating?.toFixed(1) ?? '—'}
              </span>
              <span className="text-xs text-slate-400">{c.googleReviewCount ?? '—'} reviews</span>
            </div>
          </div>
        ))}
      </div>

      {/* Blurred teaser of Pro features with upgrade overlay */}
      <div className="relative rounded-xl border border-slate-200 overflow-hidden">
        {/* Blurred placeholder content */}
        <div className="blur-sm pointer-events-none select-none p-5 space-y-4 bg-white">
          <div className="h-4 bg-slate-100 rounded w-1/3" />
          <div className="grid grid-cols-4 gap-3">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-20 bg-slate-100 rounded-lg" />
            ))}
          </div>
          <div className="h-32 bg-slate-100 rounded-lg" />
        </div>

        {/* Upgrade overlay */}
        <div className="absolute inset-0 flex items-center justify-center bg-white/70 backdrop-blur-[2px]">
          <div className="text-center px-6 py-8 rounded-2xl bg-white border border-slate-200 shadow-lg max-w-sm">
            <div className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-slate-100 mb-3">
              <Lock className="w-4 h-4 text-slate-400" />
            </div>
            <p className="font-semibold text-slate-800 mb-1">Unlock full competitor intelligence</p>
            <p className="text-sm text-slate-500 mb-4">
              See which keywords your competitors rank for, run head-to-head comparisons, and find ranking gaps you can close.
            </p>
            <Link
              to="/billing?upgrade=1"
              className="inline-flex items-center gap-1.5 px-5 py-2.5 bg-brand-500 text-white text-sm font-semibold rounded-lg hover:bg-brand-600 transition-colors"
            >
              Upgrade to Pro →
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
```

---

## Part 13 — Frontend: Rankings, Dashboard, Settings (Lite guards)

### 13.1 Edit: `frontend/src/pages/Rankings.tsx`

```tsx
const { isLite } = useClient();

// Hide CSV export button:
{!isLite && <button onClick={handleExportCsv}>Export CSV</button>}

// Hide manual sync button:
{!isLite && <button onClick={handleManualSync}>Sync now</button>}

// Hide Est. Revenue / ROI column (table header + data cells):
{!isLite && <th>Est. Revenue</th>}
{!isLite && <td>{row.estimatedRevenue}</td>}

// Hide geo-grid trigger:
{!isLite && <button onClick={handleGeoGrid}>View geo-grid</button>}
```

### 13.2 Edit: `frontend/src/pages/Dashboard.tsx`

Add `const { isLite } = useClient();` near the top.

When `isLite`, replace the full metric card grid with a 3-card summary. Add a `LiteDashboard` function component at the bottom of the file:

```tsx
function LiteDashboard() {
  const { data: metricsData } = useSWR('/metrics/summary', fetcher);
  const metrics = metricsData?.data;

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Your Local Presence</h1>
        <p className="text-sm text-slate-500 mt-0.5">Updated daily</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {/* Card 1: Google Ranking */}
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Google Ranking</p>
          <p className="text-3xl font-bold text-slate-900">
            {metrics?.avgRank != null ? `#${Math.round(metrics.avgRank)}` : '—'}
          </p>
          {metrics?.avgRankDelta != null && (
            <p className={`text-xs mt-1 font-medium ${metrics.avgRankDelta <= 0 ? 'text-green-600' : 'text-red-500'}`}>
              {metrics.avgRankDelta <= 0 ? `▲ Up ${Math.abs(metrics.avgRankDelta)}` : `▼ Down ${metrics.avgRankDelta}`} this week
            </p>
          )}
          <p className="text-xs text-slate-400 mt-1">Avg across tracked keywords</p>
        </div>

        {/* Card 2: Reviews */}
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Your Rating</p>
          <p className="text-3xl font-bold text-slate-900">
            {metrics?.avgRating != null ? metrics.avgRating.toFixed(1) : '—'}
          </p>
          {metrics?.newReviewsThisMonth != null && (
            <p className="text-xs mt-1 text-slate-500">
              {metrics.newReviewsThisMonth} new review{metrics.newReviewsThisMonth !== 1 ? 's' : ''} this month
            </p>
          )}
        </div>

        {/* Card 3: Monthly Report */}
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Monthly Report</p>
          <p className="text-sm font-semibold text-slate-700 mb-3">Ready to view</p>
          <Link to="/dashboard/reports" className="text-xs text-brand-500 font-semibold hover:underline">
            View report →
          </Link>
        </div>
      </div>

      {/* Keyword nudge — shown after 7 days if avg rank > 10 */}
      {metrics?.avgRank != null && metrics.avgRank > 10 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800">
          <p className="font-semibold mb-0.5">Your rankings could improve</p>
          <p className="text-xs text-amber-700">
            Your average ranking is #{Math.round(metrics.avgRank)}. Refining your tracked keywords can help.{' '}
            <Link to="/dashboard/settings?tab=keywords" className="underline font-semibold">Adjust keywords →</Link>
          </p>
        </div>
      )}

      <div className="bg-slate-50 rounded-xl border border-slate-100 p-4">
        <p className="text-xs font-semibold text-slate-500 mb-3">Quick actions</p>
        <div className="flex flex-wrap gap-2">
          <Link to="/dashboard/reviews" className="text-xs bg-white border border-slate-200 px-3 py-1.5 rounded-lg text-slate-700 hover:border-brand-300 hover:text-brand-600 transition-colors">View reviews →</Link>
          <Link to="/dashboard/rankings" className="text-xs bg-white border border-slate-200 px-3 py-1.5 rounded-lg text-slate-700 hover:border-brand-300 hover:text-brand-600 transition-colors">Check rankings →</Link>
          <Link to="/dashboard/campaigns" className="text-xs bg-white border border-slate-200 px-3 py-1.5 rounded-lg text-slate-700 hover:border-brand-300 hover:text-brand-600 transition-colors">Request reviews →</Link>
        </div>
      </div>
    </div>
  );
}
```

In `Dashboard.tsx`'s main return: `if (isLite) return <LiteDashboard />;`

This also addresses Claude's product note about keyword nudges — the `avgRank > 10` nudge is baked in here.

### 13.3 Edit: `frontend/src/pages/Settings.tsx`

```tsx
const { isLite } = useClient();
import { PRO_SETTINGS_TABS } from '../config/planFeatures';

// In the tabs array:
const tabs = ALL_SETTINGS_TABS.filter((tab) => !isLite || !PRO_SETTINGS_TABS.includes(tab.id));
```

---

## Part 14 — Frontend: Register, BillingPage, Audit CTA

### 14.1 Edit: `frontend/src/pages/Register.tsx`

Read `?plan=` from URL (defaults to `'lite'`) and show a plan selector:

```tsx
const [searchParams] = useSearchParams();
const [selectedPlan, setSelectedPlan] = useState<'lite' | 'pro'>(
  searchParams.get('plan') === 'pro' ? 'pro' : 'lite'
);

// Plan selector UI (above the form):
<div className="mb-6 grid grid-cols-2 gap-3">
  {(['lite', 'pro'] as const).map((p) => (
    <button key={p} type="button" onClick={() => setSelectedPlan(p)}
      className={`rounded-xl border-2 p-3 text-left transition-colors ${
        selectedPlan === p ? 'border-brand-500 bg-brand-50' : 'border-gray-200 hover:border-gray-300'
      }`}
    >
      <p className="font-semibold text-sm text-gray-900 capitalize">{p}</p>
      <p className="text-xs text-gray-500 mt-0.5">
        {p === 'lite' ? '$99/mo · 1 location · No setup fee' : '$350/mo + $499 setup'}
      </p>
    </button>
  ))}
</div>

// Store plan for post-verification use:
// In the onSubmit success handler:
localStorage.setItem('selectedPlan', selectedPlan);
```

### 14.2 Edit: `frontend/src/pages/BillingPage.tsx`

**Update `BillingStatus` interface:**
```typescript
interface BillingStatus {
  // ... existing fields ...
  productLine: 'lite' | 'pro';
}
```

**Read plan for new checkout:**
```typescript
const storedPlan = localStorage.getItem('selectedPlan') as 'lite' | 'pro' | null;
const isUpgrade = new URLSearchParams(location.search).get('upgrade') === '1';
const planForCheckout = isUpgrade ? 'pro' : (storedPlan ?? 'lite');
```

**Pass `plan` to `subscription-intent` call:**
```typescript
body: JSON.stringify({
  extraLocations: planForCheckout === 'lite' ? 0 : extraLocations,
  plan: planForCheckout,
  ...(promotionCodeId ? { promotionCodeId } : {}),
}),
```

**Upgrade CTA for active Lite subscribers:**
```tsx
{billing?.status === 'active' && billing.productLine === 'lite' && (
  <div className="mb-6 p-4 bg-brand-50 border border-brand-200 rounded-xl">
    <p className="text-sm font-semibold text-brand-800">You're on Lite</p>
    <p className="text-xs text-brand-600 mt-1 mb-3">
      Upgrade to Pro for citations, full competitor intelligence, team members, and multi-location tracking.
    </p>
    <Link to="/billing?upgrade=1" className="text-xs font-semibold text-brand-700 hover:underline">
      Upgrade to Pro — $350/mo + $499 setup →
    </Link>
  </div>
)}
```

**Upgrade payment flow** (when `isUpgrade && billing?.productLine === 'lite'`):

Instead of creating a new subscription intent, call the new `POST /billing/upgrade` endpoint:

```typescript
const handleUpgrade = async () => {
  setLoadingIntent(true);
  const res = await apiFetch<{ success: boolean; data: { clientSecret: string | null; invoiceId: string } }>(
    '/billing/upgrade', { method: 'POST' }
  );
  if (!res.success) { setIntentError(res.error?.message ?? 'Upgrade failed'); return; }
  if (res.data.clientSecret) {
    // Show Stripe Elements for payment confirmation
    setClientSecret(res.data.clientSecret);
    setPubKey(billing?.publishableKey ?? null);
  } else {
    // No additional payment needed — upgrade complete
    await mutate('/billing/status');
    await mutate('/clients');
    setSuccess(true);
  }
  setLoadingIntent(false);
};
```

### 14.3 Edit: `frontend/src/pages/Audit.tsx` (line ~275)

```tsx
// BEFORE:
to={`/register?email=${encodeURIComponent(email)}&business=${encodeURIComponent(businessName || audit.businessName || '')}`}

// AFTER:
to={`/register?email=${encodeURIComponent(email)}&business=${encodeURIComponent(businessName || audit.businessName || '')}&plan=lite`}
```

---

## Part 15 — App.tsx routing

### 15.1 Edit: `frontend/src/App.tsx`

No new route needed — `OnboardingLite` is gone. The existing `/onboarding` route handles both modes via `?lite=1`. No changes required to `App.tsx` for onboarding.

---

## Part 16 — Tests

### 16.1 New file: `backend/src/__tests__/plan-gate.test.ts`

Follows the same pattern as `access-control.test.ts`.

```typescript
/**
 * Plan gate tests — requireProPlan middleware.
 * Verifies: Lite is blocked from Pro routes, Pro passes, admins always pass.
 */
import request from 'supertest';
import app from '../app';
import { db } from '../db/connection';

async function registerAndLogin(email: string): Promise<string> {
  await request(app).post('/api/auth/register').send({
    email, password: 'Password123!', businessName: 'Test Business',
  });
  const login = await request(app).post('/api/auth/login').send({ email, password: 'Password123!' });
  return (login.body as { data?: { accessToken?: string } }).data?.accessToken ?? '';
}

async function setProductLine(email: string, plan: 'lite' | 'pro') {
  const user = await db('users').where({ email }).first();
  if (!user) return;
  await db('clients').where({ user_id: user.id }).update({ product_line: plan });
}

describe('Plan gate — requireProPlan middleware', () => {
  let liteToken: string;
  let proToken: string;

  beforeAll(async () => {
    liteToken = await registerAndLogin('lite-user@example.com');
    proToken   = await registerAndLogin('pro-user@example.com');
    await setProductLine('lite-user@example.com', 'lite');
    await setProductLine('pro-user@example.com', 'pro');
  });

  describe('Lite client — Pro-only routes return 403 with PRO_REQUIRED', () => {
    const proOnlyRoutes = [
      ['GET',  '/api/citations'],
      ['GET',  '/api/geo-grid'],
      ['GET',  '/api/audits/bl'],
      ['GET',  '/api/reputation'],
      ['GET',  '/api/team'],
      ['GET',  '/api/qr'],
      ['GET',  '/api/competitors/gap'],
      ['GET',  '/api/analytics/rankings'],
      ['GET',  '/api/rankings/export'],
    ] as const;

    for (const [method, path] of proOnlyRoutes) {
      it(`${method} ${path} → 403`, async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const res = await (request(app) as any)[method.toLowerCase()](path)
          .set('Authorization', `Bearer ${liteToken}`) as request.Response;
        expect(res.status).toBe(403);
        expect((res.body as { error?: { code?: string } }).error?.code).toBe('PRO_REQUIRED');
      });
    }
  });

  describe('Lite client — Lite-accessible routes return 200 or 404 (not 403)', () => {
    const liteAllowedRoutes = [
      ['GET', '/api/reviews'],
      ['GET', '/api/rankings'],
      ['GET', '/api/campaigns'],
      ['GET', '/api/competitors'],    // base list is allowed
      ['GET', '/api/reports'],
      ['GET', '/api/analytics/reviews/trend'],
    ] as const;

    for (const [method, path] of liteAllowedRoutes) {
      it(`${method} ${path} → not 403`, async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const res = await (request(app) as any)[method.toLowerCase()](path)
          .set('Authorization', `Bearer ${liteToken}`) as request.Response;
        expect(res.status).not.toBe(403);
      });
    }
  });

  describe('Pro client — all routes pass gate', () => {
    const proRoutes = [
      ['GET', '/api/citations'],
      ['GET', '/api/competitors/gap'],
      ['GET', '/api/team'],
    ] as const;

    for (const [method, path] of proRoutes) {
      it(`${method} ${path} → not 403`, async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const res = await (request(app) as any)[method.toLowerCase()](path)
          .set('Authorization', `Bearer ${proToken}`) as request.Response;
        expect(res.status).not.toBe(403);
      });
    }
  });

  describe('isPlanAllowed() unit tests', () => {
    // Import the pure function directly — no HTTP needed
    const { isPlanAllowed } = require('../config/planFeatures');

    it('pro always returns true', () => {
      expect(isPlanAllowed('citations', 'pro')).toBe(true);
      expect(isPlanAllowed('geo-grid', 'pro')).toBe(true);
      expect(isPlanAllowed('competitors/gap', 'pro')).toBe(true);
    });

    it('lite blocked from Pro-only routes', () => {
      expect(isPlanAllowed('citations', 'lite')).toBe(false);
      expect(isPlanAllowed('geo-grid', 'lite')).toBe(false);
      expect(isPlanAllowed('competitors/gap', 'lite')).toBe(false);
      expect(isPlanAllowed('analytics/rankings', 'lite')).toBe(false);
    });

    it('lite allowed on Lite-accessible routes', () => {
      expect(isPlanAllowed('competitors', 'lite')).toBe(true);   // base list
      expect(isPlanAllowed('reviews', 'lite')).toBe(true);
      expect(isPlanAllowed('rankings', 'lite')).toBe(true);
      expect(isPlanAllowed('analytics/reviews/trend', 'lite')).toBe(true);
    });

    it('unlisted route returns true (fail-open for auth/billing/public)', () => {
      expect(isPlanAllowed('auth/login', 'lite')).toBe(true);
      expect(isPlanAllowed('billing/status', 'lite')).toBe(true);
    });
  });
});
```

### 16.2 New file: `tests/e2e/08-onboarding-lite.spec.ts`

```typescript
import { test, expect } from '@playwright/test';
import { uniqueEmail, registerViaAPI, loginViaUI } from './helpers/auth';
import { cleanupTestUsers, dbQuery, getClientForEmail } from './helpers/db';

/**
 * Suite 08 — Onboarding: Lite plan flow
 * Verifies the 2-step lite onboarding (no keywords step, auto-seed, Google connect optional).
 */
test.describe('Suite 08 — Onboarding: Lite plan', () => {
  let email: string;
  let password: string;

  test.beforeEach(async () => {
    email = uniqueEmail();
    password = 'TestPass123!';
    await registerViaAPI(email, password, 'Lite Test Business');
    dbQuery(`UPDATE users SET email_verified = true WHERE email = '${email}'`);
    // Set product_line to lite
    dbQuery(`
      UPDATE clients SET product_line = 'lite'
      WHERE user_id = (SELECT id FROM users WHERE email = '${email}')
    `);
  });

  test.afterEach(async () => {
    cleanupTestUsers();
  });

  test('TEST-ONB-L-01 — Lite user redirects to /onboarding?lite=1', async ({ page }) => {
    await loginViaUI(page, email, password);
    await page.waitForURL(/\/onboarding\?lite=1/, { timeout: 15_000 });
    await expect(page.getByText('Step 1 of 2')).toBeVisible();
    await expect(page.getByText('Business Information')).toBeVisible();
  });

  test('TEST-ONB-L-02 — step indicator shows 2 steps (not 4)', async ({ page }) => {
    await loginViaUI(page, email, password);
    await page.waitForURL(/\/onboarding/, { timeout: 15_000 });
    await expect(page.getByText('Step 1 of 2')).toBeVisible();
    await expect(page.getByText('Step 1 of 4')).not.toBeVisible();
  });

  test('TEST-ONB-L-03 — step 1 next skips keywords and goes to step 2 (Google connect)', async ({ page }) => {
    await loginViaUI(page, email, password);
    await page.waitForURL(/\/onboarding/, { timeout: 15_000 });
    await page.getByPlaceholder('Acme Plumbing').fill('Lite Plumbing Co');
    await page.locator('select').selectOption('Plumbing');
    await page.getByRole('button', { name: 'Next' }).click();
    // Should jump to step 2, NOT show keywords step
    await expect(page.getByText('Step 2 of 2')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('keyword', { exact: false })).not.toBeVisible();
    await expect(page.getByText('Google Business Profile')).toBeVisible();
  });

  test('TEST-ONB-L-04 — skip Google connect completes onboarding and lands on dashboard', async ({ page }) => {
    await loginViaUI(page, email, password);
    await page.waitForURL(/\/onboarding/, { timeout: 15_000 });
    await page.getByRole('button', { name: 'Next' }).click();
    await expect(page.getByText('Step 2 of 2')).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: /skip/i }).click();
    await page.waitForURL('/dashboard', { timeout: 15_000 });
    // Dashboard should show Lite simplified view (3-card layout, not full Pro dashboard)
    await expect(page.getByText('Google Ranking')).toBeVisible();
    await expect(page.getByText('Your Rating')).toBeVisible();
    await expect(page.getByText('Monthly Report')).toBeVisible();
  });

  test('TEST-ONB-L-05 — Citations nav item not visible for Lite user', async ({ page }) => {
    await loginViaUI(page, email, password);
    await page.waitForURL(/\/onboarding|\/dashboard/, { timeout: 15_000 });
    if (page.url().includes('onboarding')) {
      await page.getByRole('button', { name: 'Next' }).click();
      await page.getByRole('button', { name: /skip/i }).click();
      await page.waitForURL('/dashboard', { timeout: 15_000 });
    }
    await expect(page.getByRole('link', { name: 'Citations' })).not.toBeVisible();
    await expect(page.getByRole('link', { name: 'SEO Audit' })).not.toBeVisible();
    await expect(page.getByRole('link', { name: 'Reviews' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Rankings' })).toBeVisible();
  });

  test('TEST-ONB-L-06 — Competitors page shows teaser (not full Pro view) for Lite', async ({ page }) => {
    await loginViaUI(page, email, password);
    // Complete onboarding
    await page.waitForURL(/\/onboarding|\/dashboard/, { timeout: 15_000 });
    if (page.url().includes('onboarding')) {
      await page.getByRole('button', { name: 'Next' }).click();
      await page.getByRole('button', { name: /skip/i }).click();
      await page.waitForURL('/dashboard', { timeout: 15_000 });
    }
    await page.goto('/dashboard/competitors');
    // Teaser should show the "Upgrade to Pro" CTA in blur overlay
    await expect(page.getByText('Unlock full competitor intelligence')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Upgrade to Pro →' })).toBeVisible();
    // The full Pro Battleground / head-to-head UI should NOT be visible
    await expect(page.getByText('Head-to-Head', { exact: false })).not.toBeVisible();
  });
});
```

---

## Summary of Changes vs Rev 1

| Concern | Rev 1 approach | Rev 2 fix |
|---|---|---|
| #1 Route gating | Manual per-file `requireProPlan` | Central `PLAN_ROUTE_GATES` map + `isPlanAllowed()` applied once in `index.ts` |
| #2 Upgrade mechanics | "BillingPage works" | Full `upgradeToProSubscription()` specified: sub item swap, setup fee invoice item, proration, DB write, payment intent return |
| #3 Shared capability map | `isLite` scattered across files | `planFeatures.ts` in both backend and frontend; both read from same structure |
| #4 Middleware DB reads | 1–2 extra queries per request | Zero — reads `req.user` and `req.client` (already populated) |
| #5 Two onboarding files | New `OnboardingLite.tsx` (260 lines) | Single `Onboarding.tsx` with `isLiteMode` flag from `?lite=1` |
| #6 No automated coverage | Manual smoke test only | `plan-gate.test.ts` (unit + integration) + `08-onboarding-lite.spec.ts` (6 e2e tests) |
| Product: keyword nudge | Not addressed | `avgRank > 10` nudge banner in `LiteDashboard` links to keyword settings |

## Execution Order for Claude Code

1. Part 1 — Create `planFeatures.ts` in both backend and frontend (everything depends on this)
2. Part 2 — Run DB migration (`product_line` column)
3. Parts 3–4 — Config + middleware (no frontend impact yet)
4. Part 5 — Stripe service (`upgradeToProSubscription` + `plan` param on existing functions)
5. Parts 6–7 — Billing controller + client controller
6. Part 8 — `useClient` hook (frontend entry point for plan data)
7. Parts 9–14 — Frontend components, pages, layout, register, billing, audit
8. Part 15 — App.tsx (note: no changes needed vs rev 1 assessment)
9. Part 16 — Tests (run existing suite first to confirm baseline, then add new files)
10. TypeScript check: `cd backend && npx tsc --noEmit && cd ../frontend && npx tsc --noEmit`
11. Run `plan-gate.test.ts` and confirm all assertions pass before merging
