# SuperLocalSEO — Lite/Pro Split: Claude Code Implementation Spec

**Goal:** Introduce a `product_line: 'lite' | 'pro'` gate across the full stack so two distinct product tiers can be served from a single codebase with no disruption to existing clients.

**Decisions baked in:**
- Lite = $99/mo, single location only, no setup fee
- Pro = $350/mo + $499 setup (current), multi-location
- Lite gets: Dashboard, Rankings (read-only), Reviews, Campaigns, Reports, Settings
- Lite also gets: a **blurred/locked teaser** of the Competitors page to drive upgrades
- Lite does NOT get: Citations, geo-grid, BrightLocal audits, SEO Audit history, QR codes, Team members, analytics exports, CSV exports, head-to-head/gap competitor tools
- Free audit → defaults to Lite CTA post-audit
- Lite onboarding = 2 steps (no keywords step; auto-seed from industry)
- All existing clients default to `'pro'` — zero disruption

---

## File Map

All paths are repo-relative. Backend = `backend/src/`, Frontend = `frontend/src/`.

---

## Part 1 — Database Migration

### 1.1 New file: `backend/src/db/migrations/YYYYMMDD000000_product_line.ts`

Use today's date for YYYYMMDD (e.g. `20260624000000_product_line.ts`).

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

## Part 2 — Backend Config (Stripe Lite price)

### 2.1 Edit: `backend/src/config.ts`

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
  setup: optional('STRIPE_SETUP_PRICE_ID'),
  base: optional('STRIPE_BASE_PRICE_ID'),
  location: optional('STRIPE_LOCATION_PRICE_ID'),
  liteBase: optional('STRIPE_LITE_BASE_PRICE_ID'),  // $99/mo recurring
},
```

### 2.2 Edit: `.env.example`

Add the new variable:
```
STRIPE_LITE_BASE_PRICE_ID=     # Stripe price ID for Lite plan ($99/mo)
```

---

## Part 3 — Backend Middleware

### 3.1 New file: `backend/src/middleware/requireProPlan.ts`

```typescript
import { Request, Response, NextFunction } from 'express';
import { db } from '../db/connection';

/**
 * Blocks Lite-plan clients from Pro-only routes.
 * Must be placed AFTER requireAuth and requireClient in the route chain.
 * Admins (role='admin') always bypass.
 */
export async function requireProPlan(req: Request, res: Response, next: NextFunction): Promise<void> {
  // requireAuth hasn't run yet — nothing to check
  if (!req.userId) { next(); return; }

  // Admins always pass
  const user = await db('users').where({ id: req.userId }).first();
  if (user?.role === 'admin') { next(); return; }

  // requireClient hasn't populated req.client yet — read it ourselves
  const client = req.client ?? await db('clients').where({ user_id: req.userId }).first();
  if (!client) { next(); return; }

  if (client.product_line === 'pro' || !client.product_line) {
    next(); return;
  }

  res.status(403).json({
    success: false,
    error: {
      code: 'PRO_REQUIRED',
      message: 'This feature requires the Pro plan.',
    },
  });
}
```

---

## Part 4 — Apply Route Gates

### 4.1 Edit: `backend/src/routes/citations.ts`

Add `requireProPlan` import and apply to ALL routes:

```typescript
import { requireProPlan } from '../middleware/requireProPlan';

// Apply to every route in this file — replace existing requireClient usage:
router.get('/', requireClient, requireProPlan, ...);
router.get('/scan', requireClient, requireProPlan, ...);
// etc. — add requireProPlan after requireClient on every route in this file
```

### 4.2 Edit: `backend/src/routes/competitors.ts`

The basic `GET /` (list with rating + review count) stays open to Lite — this powers the teaser view.
All other routes get `requireProPlan`:

```typescript
import { requireProPlan } from '../middleware/requireProPlan';

// Basic list — Lite can read this (used for teaser)
router.get('/', requireClient, competitor.list);

// All other routes — Pro only:
router.get('/gap',             requireClient, requireProPlan, competitor.gap);
router.get('/head-to-head',    requireClient, requireProPlan, competitor.headToHead);
router.get('/search',          requireClient, requireProPlan, competitor.search);
router.post('/',               requireClient, requireProPlan, requireTeamAdmin, competitor.create);
router.get('/scan-status',     requireClient, requireProPlan, competitor.scanStatus);
router.post('/sync-rankings',  requireClient, requireProPlan, requireTeamAdmin, competitor.syncRankings);
router.delete('/:id',          requireClient, requireProPlan, requireTeamAdmin, competitor.remove);
router.post('/:id/sync',       requireClient, requireProPlan, requireTeamAdmin, competitor.sync);
router.get('/:id/discover-keywords', requireClient, requireProPlan, competitor.discoverKeywords);
```

### 4.3 Edit: `backend/src/routes/audits_bl.ts` (or wherever BrightLocal audit routes live)

Apply `requireProPlan` to all routes.

### 4.4 Edit: analytics routes

Apply `requireProPlan` to CSV export endpoints and `/analytics/rankings/*` routes. Leave `/analytics/reviews/trend` open.

### 4.5 Edit: `backend/src/routes/` — QR code routes

Apply `requireProPlan` to all QR routes.

### 4.6 Edit: `backend/src/routes/` — Team routes

Apply `requireProPlan` to all team member routes.

---

## Part 5 — Stripe Service: Add Lite plan support

### 5.1 Edit: `backend/src/services/stripe.service.ts`

**Update `createCheckoutSession` signature to accept `plan` parameter:**

```typescript
// BEFORE:
export async function createCheckoutSession(
  customerId: string,
  extraLocations: number,
  successUrl: string,
  cancelUrl: string,
  userId: string,
): Promise<Stripe.Checkout.Session>

// AFTER:
export async function createCheckoutSession(
  customerId: string,
  extraLocations: number,
  successUrl: string,
  cancelUrl: string,
  userId: string,
  plan: 'lite' | 'pro' = 'pro',
): Promise<Stripe.Checkout.Session>
```

**Update the function body to branch on `plan`:**

```typescript
export async function createCheckoutSession(
  customerId: string,
  extraLocations: number,
  successUrl: string,
  cancelUrl: string,
  userId: string,
  plan: 'lite' | 'pro' = 'pro',
): Promise<Stripe.Checkout.Session> {
  let lineItems: Stripe.Checkout.SessionCreateParams.LineItem[];

  if (plan === 'lite') {
    // Lite: single price, no setup fee, no extra locations
    lineItems = [
      { price: config.stripe.prices.liteBase!, quantity: 1 },
    ];
  } else {
    // Pro: setup fee + base + optional extra locations (existing behaviour)
    lineItems = [
      { price: config.stripe.prices.setup!, quantity: 1 },
      { price: config.stripe.prices.base!, quantity: 1 },
    ];
    if (extraLocations > 0) {
      lineItems.push({ price: config.stripe.prices.location!, quantity: extraLocations });
    }
  }

  return stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    line_items: lineItems,
    subscription_data: {
      metadata: { userId, extraLocations: String(plan === 'lite' ? 0 : extraLocations), plan },
    },
    metadata: { userId, extraLocations: String(plan === 'lite' ? 0 : extraLocations), plan },
    success_url: successUrl,
    cancel_url: cancelUrl,
  });
}
```

**Update `createSubscriptionIntent` to accept `plan` parameter** (same pattern — add `plan: 'lite' | 'pro' = 'pro'` and branch similarly).

**Update `handleWebhookEvent` — `checkout.session.completed` case:**

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

**Also update `customer.subscription.updated` case** to preserve `product_line` (don't overwrite it on renewal events — just leave it out of the update payload since it doesn't change on renewal).

---

## Part 6 — Billing Controller

### 6.1 Edit: `backend/src/controllers/billing.controller.ts`

**Update `checkout` handler to accept and pass `plan`:**

```typescript
export async function checkout(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const plan = req.body.plan === 'lite' ? 'lite' : 'pro';   // ← NEW
    const extraLocations = plan === 'lite' ? 0 : Math.max(0, parseInt(req.body.extraLocations ?? '0', 10));
    const user = await db('users').where({ id: req.userId }).first();
    if (!user) { err(res, 'User not found', 404, 'NOT_FOUND'); return; }

    const customerId = await getOrCreateStripeCustomer(req.userId!, user.email as string);
    const successUrl = `${config.appUrl}/billing/success`;
    const cancelUrl = `${config.appUrl}/dashboard/settings?tab=billing`;
    const session = await createCheckoutSession(
      customerId,
      extraLocations,
      successUrl,
      cancelUrl,
      req.userId!,
      plan,   // ← NEW
    );

    ok(res, { url: session.url });
  } catch (e) { next(e); }
}
```

**Update `subscriptionIntent` handler the same way** — accept `plan` from `req.body.plan`, pass to `createSubscriptionIntent`.

**Update `status` handler to expose `productLine`:**

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

## Part 7 — Client Controller: Expose `product_line` to frontend

### 7.1 Edit: `backend/src/controllers/client.controller.ts`

In the `formatClient` function, add `productLine` to the return object:

```typescript
function formatClient(client, locations, email, integrations) {
  // ... existing code ...
  return {
    id: client.id,
    email,
    businessName: client.business_name,
    industry: client.industry,
    productLine: (client.product_line as string | null) ?? 'pro',   // ← NEW
    billing: {
      plan: client.subscription_tier ?? 'free',
      status: client.subscription_status ?? 'inactive',
    },
    // ... rest unchanged ...
  };
}
```

---

## Part 8 — Frontend: `useAuth` / `useClient` hook

The existing `useAuth` hook (`hooks/useAuth.ts`) provides `userId` and `role` from the JWT. It does NOT fetch `/clients`. `productLine` lives on the client record, so we need to surface it from the SWR `/clients` fetch that already happens in `DashboardLayout`.

### 8.1 New file: `frontend/src/hooks/useClient.ts`

```typescript
import useSWR from 'swr';
import { fetcher } from '../services/api';
import { useAuth } from './useAuth';

interface ClientData {
  id: string;
  email: string;
  businessName: string;
  industry: string | null;
  productLine: 'lite' | 'pro';
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
  productLine: 'lite' | 'pro';
  isLite: boolean;
  isPro: boolean;
  loading: boolean;
}

export function useClient(): UseClientResult {
  const { isAuthenticated, role } = useAuth();
  const { data, isLoading } = useSWR<{ success: boolean; data: ClientData }>(
    isAuthenticated && role === 'client' ? '/clients' : null,
    fetcher,
  );

  const client = data?.data ?? null;
  const productLine = (client?.productLine ?? 'pro') as 'lite' | 'pro';

  return {
    client,
    productLine,
    isLite: productLine === 'lite',
    isPro: productLine === 'pro',
    loading: isLoading,
  };
}
```

---

## Part 9 — Frontend: Nav Config & DashboardLayout

### 9.1 Edit: `frontend/src/layouts/DashboardLayout.tsx`

**Replace the static `navItems` array with a plan-aware config:**

```typescript
// Remove the existing static navItems array and replace with:

interface NavItem {
  to: string;
  label: string;
  icon: React.ReactNode;
  plans: ('lite' | 'pro')[];
}

const ALL_NAV_ITEMS: NavItem[] = [
  { to: '/dashboard',             label: 'Dashboard',   icon: <Home size={17} />,        plans: ['lite', 'pro'] },
  { to: '/dashboard/rankings',    label: 'Rankings',    icon: <BarChart2 size={17} />,   plans: ['lite', 'pro'] },
  { to: '/dashboard/reviews',     label: 'Reviews',     icon: <Star size={17} />,        plans: ['lite', 'pro'] },
  { to: '/dashboard/campaigns',   label: 'Campaigns',   icon: <Megaphone size={17} />,   plans: ['lite', 'pro'] },
  { to: '/dashboard/competitors', label: 'Competitors', icon: <Users2 size={17} />,      plans: ['lite', 'pro'] }, // Lite sees teaser
  { to: '/dashboard/citations',   label: 'Citations',   icon: <Link2 size={17} />,       plans: ['pro'] },
  { to: '/dashboard/audit',       label: 'SEO Audit',   icon: <ClipboardList size={17} />, plans: ['pro'] },
  { to: '/dashboard/reports',     label: 'Reports',     icon: <FileText size={17} />,    plans: ['lite', 'pro'] },
  { to: '/dashboard/settings',    label: 'Settings',    icon: <Settings size={17} />,    plans: ['lite', 'pro'] },
];
```

**In `SidebarNav`, import `useClient` and filter nav items:**

```typescript
import { useClient } from '../hooks/useClient';

function SidebarNav({ onNav }: { onNav?: () => void }) {
  const { logout, role } = useAuth();
  const { productLine } = useClient();

  // Admins see everything; clients see plan-filtered nav
  const navItems = role === 'admin'
    ? ALL_NAV_ITEMS
    : ALL_NAV_ITEMS.filter((item) => item.plans.includes(productLine));

  return (
    <>
      <nav className="flex-1 px-2.5 py-2 space-y-0.5" aria-label="Dashboard navigation">
        {navItems.map((item) => (
          // ... existing NavLink JSX unchanged ...
        ))}
      </nav>
      // ... rest unchanged ...
    </>
  );
}
```

**Update `OnboardingRedirect` to route Lite users to the new Lite onboarding:**

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
      // Route to Lite or Pro onboarding based on plan
      const dest = productLine === 'lite' ? '/onboarding/lite' : '/onboarding';
      navigate(dest, { replace: true });
    }
  }, [data, role, navigate, productLine]);

  return null;
}
```

---

## Part 10 — Frontend: `ProGate` component

### 10.1 New file: `frontend/src/components/ProGate.tsx`

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
        to="/billing"
        className="inline-flex items-center gap-1.5 px-5 py-2.5 bg-brand-500 text-white text-sm font-semibold rounded-lg hover:bg-brand-600 transition-colors"
      >
        Upgrade to Pro →
      </Link>
    </div>
  );
}
```

---

## Part 11 — Frontend: Competitors teaser (blurred preview for Lite)

### 11.1 Edit: `frontend/src/pages/Competitors.tsx`

At the top of the component, add the `useClient` hook. Wrap the main content body in a conditional:

```tsx
import { useClient } from '../hooks/useClient';
// ... existing imports ...

export default function Competitors() {
  const { isLite } = useClient();
  // ... all existing state and data fetching stays ...

  // For Lite, still fetch GET /competitors (basic list — allowed for Lite)
  // but show teaser for everything else

  if (isLite) {
    return <CompetitorsTeaserView competitors={competitorsData} />;
  }

  // ... existing full Pro render ...
}
```

**Add the teaser component at the bottom of `Competitors.tsx`:**

```tsx
interface TeaserProps {
  competitors: Competitor[] | undefined;
}

function CompetitorsTeaserView({ competitors }: TeaserProps) {
  // Show up to 3 competitors with rating + review count visible,
  // then a blur overlay with upgrade CTA over the rest of the page.
  const visibleCompetitors = (competitors ?? []).slice(0, 3);

  // Generate fake blurred rows if no competitors added yet
  const placeholders = Array.from({ length: Math.max(0, 3 - visibleCompetitors.length) }, (_, i) => ({
    id: `placeholder-${i}`,
    name: ['Main Street Plumbing', 'City HVAC Services', 'Premier Contractors'][i],
    googleRating: [4.8, 4.6, 4.3][i],
    googleReviewCount: [312, 187, 94][i],
  }));

  const rows = [
    ...visibleCompetitors.map((c) => ({ id: c.id, name: c.name, googleRating: c.googleRating, googleReviewCount: c.googleReviewCount })),
    ...placeholders,
  ];

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-slate-900">Competitors</h1>
        <p className="text-sm text-slate-500 mt-1">See how you stack up against local competitors.</p>
      </div>

      {/* Visible competitor snapshot */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden mb-4">
        <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
          <span className="text-sm font-semibold text-slate-700">Local competitors</span>
          <span className="text-xs text-slate-400">Rating · Reviews</span>
        </div>
        {rows.map((c) => (
          <div key={c.id} className="flex items-center justify-between px-5 py-3.5 border-b border-slate-50 last:border-0">
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

      {/* Blurred teaser of advanced features */}
      <div className="relative rounded-xl border border-slate-200 overflow-hidden">
        {/* Fake blurred content underneath */}
        <div className="blur-sm pointer-events-none select-none p-5 space-y-4 bg-white">
          <div className="h-4 bg-slate-100 rounded w-1/3" />
          <div className="grid grid-cols-4 gap-3">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-20 bg-slate-100 rounded-lg" />
            ))}
          </div>
          <div className="h-32 bg-slate-100 rounded-lg" />
          <div className="h-4 bg-slate-100 rounded w-1/2" />
          <div className="h-4 bg-slate-100 rounded w-2/3" />
        </div>

        {/* Overlay CTA */}
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-white/70 backdrop-blur-[2px]">
          <div className="text-center px-6 py-8 rounded-2xl bg-white border border-slate-200 shadow-lg max-w-sm">
            <div className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-slate-100 mb-3">
              <Lock className="w-4 h-4 text-slate-400" />
            </div>
            <p className="font-semibold text-slate-800 mb-1">Unlock full competitor intelligence</p>
            <p className="text-sm text-slate-500 mb-4">
              See which keywords your competitors rank for, run head-to-head comparisons, and find ranking gaps you can close — all on Pro.
            </p>
            <Link
              to="/billing"
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

**Required imports to add to `Competitors.tsx`:** `Lock` from lucide-react, `Link` from react-router-dom, `useClient` from `../hooks/useClient`.

---

## Part 12 — Frontend: Rankings page (hide Pro features for Lite)

### 12.1 Edit: `frontend/src/pages/Rankings.tsx`

Add `useClient` import and conditionally hide Pro-only elements.

Add near the top of the component:
```tsx
const { isLite } = useClient();
```

Then throughout the JSX, apply `isLite` guards:

```tsx
// CSV Export button — hide for Lite
{!isLite && (
  <button onClick={handleExportCsv} ...>Export CSV</button>
)}

// Manual sync button — hide for Lite
{!isLite && (
  <button onClick={handleManualSync} ...>Sync now</button>
)}

// Est. Revenue / ROI column in table — hide for Lite
// Find the column header and data cells for ROI/revenue and wrap in {!isLite && ...}

// Geo-grid trigger — hide for Lite
{!isLite && (
  <button onClick={handleGeoGrid} ...>View geo-grid</button>
)}
```

---

## Part 13 — Frontend: Dashboard home (Lite simplified view)

### 13.1 Edit: `frontend/src/pages/Dashboard.tsx`

Add `useClient` and render a simplified 3-card layout for Lite:

```tsx
import { useClient } from '../hooks/useClient';

export default function Dashboard() {
  const { isLite } = useClient();
  // ... existing data fetching (keep all SWR calls as-is) ...

  if (isLite) {
    return <LiteDashboard />;
  }

  return <ProDashboard />; // existing full dashboard JSX
}
```

**Add `LiteDashboard` component at the bottom of `Dashboard.tsx`:**

This component reads from the same SWR hooks already in the parent. Extract the data it needs as props or let it call `useClient` + the same `useSWR` endpoints:

```tsx
function LiteDashboard() {
  // Reuse existing data hooks — these SWR calls are already cached
  const { data: metricsData } = useSWR('/metrics/summary', fetcher);
  const { data: reviewsData } = useSWR('/analytics/reviews/trend?period=30d', fetcher);

  const avgRank = metricsData?.data?.avgRank ?? null;
  const rankDelta = metricsData?.data?.avgRankDelta ?? null;
  const avgRating = metricsData?.data?.avgRating ?? null;
  const newReviewsThisMonth = metricsData?.data?.newReviewsThisMonth ?? null;

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
            {avgRank !== null ? `#${Math.round(avgRank)}` : '—'}
          </p>
          {rankDelta !== null && (
            <p className={`text-xs mt-1 font-medium ${rankDelta <= 0 ? 'text-green-600' : 'text-red-500'}`}>
              {rankDelta <= 0 ? `▲ Up ${Math.abs(rankDelta)}` : `▼ Down ${rankDelta}`} this week
            </p>
          )}
          <p className="text-xs text-slate-400 mt-1">Avg across tracked keywords</p>
        </div>

        {/* Card 2: Reviews */}
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Your Rating</p>
          <p className="text-3xl font-bold text-slate-900">
            {avgRating !== null ? avgRating.toFixed(1) : '—'}
          </p>
          {newReviewsThisMonth !== null && (
            <p className="text-xs mt-1 font-medium text-slate-500">
              {newReviewsThisMonth} new review{newReviewsThisMonth !== 1 ? 's' : ''} this month
            </p>
          )}
          <p className="text-xs text-slate-400 mt-1">Google avg rating</p>
        </div>

        {/* Card 3: Monthly Report */}
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Monthly Report</p>
          <p className="text-sm font-semibold text-slate-700 mb-3">Ready to view</p>
          <Link
            to="/dashboard/reports"
            className="text-xs text-brand-500 font-semibold hover:underline"
          >
            View report →
          </Link>
        </div>
      </div>

      {/* Quick links */}
      <div className="bg-slate-50 rounded-xl border border-slate-100 p-4">
        <p className="text-xs font-semibold text-slate-500 mb-3">Quick actions</p>
        <div className="flex flex-wrap gap-2">
          <Link to="/dashboard/reviews" className="text-xs bg-white border border-slate-200 px-3 py-1.5 rounded-lg text-slate-700 hover:border-brand-300 hover:text-brand-600 transition-colors">
            View reviews →
          </Link>
          <Link to="/dashboard/rankings" className="text-xs bg-white border border-slate-200 px-3 py-1.5 rounded-lg text-slate-700 hover:border-brand-300 hover:text-brand-600 transition-colors">
            Check rankings →
          </Link>
          <Link to="/dashboard/campaigns" className="text-xs bg-white border border-slate-200 px-3 py-1.5 rounded-lg text-slate-700 hover:border-brand-300 hover:text-brand-600 transition-colors">
            Request reviews →
          </Link>
        </div>
      </div>
    </div>
  );
}
```

---

## Part 14 — Frontend: Settings page (hide Pro-only tabs for Lite)

### 14.1 Edit: `frontend/src/pages/Settings.tsx`

Add `useClient` and hide Pro-only tabs:

```tsx
const { isLite } = useClient();

// In the tab bar, conditionally render Team and QR tabs:
const tabs = [
  { id: 'general', label: 'General' },
  { id: 'integrations', label: 'Integrations' },
  { id: 'billing', label: 'Billing' },
  ...(!isLite ? [{ id: 'team', label: 'Team' }] : []),
  ...(!isLite ? [{ id: 'qr', label: 'QR Codes' }] : []),
  ...(!isLite ? [{ id: 'whitelabel', label: 'White Label' }] : []),
];
```

---

## Part 15 — Frontend: Lite Onboarding (2-step wizard)

### 15.1 New file: `frontend/src/pages/OnboardingLite.tsx`

This is a NEW file — do NOT modify the existing `Onboarding.tsx`.

```tsx
import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { mutate } from 'swr';
import { apiFetch } from '../services/api';

// Reuse INDUSTRY_GROUPS from Onboarding.tsx — extract to a shared file
// or copy the array here:
const INDUSTRY_GROUPS = [
  { group: 'Home Services', options: ['Plumbing', 'HVAC', 'Electrical', 'Roofing', 'Landscaping', 'Cleaning', 'Pest Control', 'Painting', 'Flooring', 'Moving', 'General Contractor'] },
  { group: 'Health & Fitness', options: ['Personal Training', 'Gym / Fitness Studio', 'Physical Therapy', 'Chiropractic', 'Massage Therapy', 'Dental'] },
  { group: 'Legal', options: ['Law Firm', 'Family Law', 'Personal Injury'] },
  { group: 'Food & Beverage', options: ['Restaurant', 'Coffee Shop', 'Food Truck', 'Bakery'] },
  { group: 'Beauty & Personal Care', options: ['Hair Salon', 'Barbershop', 'Nail Salon', 'Med Spa'] },
  { group: 'Automotive', options: ['Auto Repair', 'Auto Detailing'] },
  { group: 'Professional Services', options: ['Accounting / CPA', 'Real Estate', 'Insurance', 'Veterinary', 'Photography', 'Tutoring'] },
  { group: 'Other', options: ['Other'] },
];

export default function OnboardingLite() {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const TOTAL_STEPS = 2;

  // Step 1 state
  const [businessName, setBusinessName] = useState('');
  const [industry, setIndustry] = useState('');
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [zip, setZip] = useState('');
  const [phone, setPhone] = useState('');

  // Step 2 state
  const [googleConnecting, setGoogleConnecting] = useState(false);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Pre-fill businessName from /clients on mount
  useEffect(() => {
    apiFetch<{ success: boolean; data: { businessName: string; industry: string | null; onboardingStep: number } }>('/clients')
      .then((res) => {
        if (res.data.businessName) setBusinessName(res.data.businessName);
        if (res.data.industry) setIndustry(res.data.industry);
        // If they already completed onboarding, redirect to dashboard
        if (res.data.onboardingStep > 0) navigate('/dashboard', { replace: true });
      })
      .catch(() => {});
  }, [navigate]);

  const handleStep1Next = async () => {
    if (!businessName.trim()) return;
    setSaving(true);
    setError('');
    try {
      // 1. Save business name + industry to client
      await apiFetch('/clients', {
        method: 'PATCH',
        body: JSON.stringify({
          businessName: businessName.trim(),
          industry: industry || undefined,
          onboardingStep: 1,
        }),
      });

      // 2. Create the location — keywords are auto-seeded server-side from industry
      await apiFetch('/locations', {
        method: 'POST',
        body: JSON.stringify({
          name: businessName.trim(),
          address: address.trim(),
          city: city.trim(),
          state: state.trim(),
          zip: zip.trim(),
          phone: phone.trim(),
          serviceArea: [],
        }),
      });

      setStep(2);
    } catch {
      setError('Failed to save. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const connectGoogle = async () => {
    setGoogleConnecting(true);
    try {
      const res = await apiFetch<{ success: boolean; data: { url: string } }>('/integrations/google/auth-url');
      if (res.success && res.data?.url) window.location.href = res.data.url;
    } finally {
      setGoogleConnecting(false);
    }
  };

  const handleFinish = async (skippedGoogle = false) => {
    setSaving(true);
    try {
      await apiFetch('/clients/complete-onboarding', { method: 'POST' });
    } catch { /* non-fatal */ } finally {
      setSaving(false);
    }
    await mutate('/clients', apiFetch('/clients'));
    navigate('/dashboard');
  };

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4">
      <div className="max-w-lg mx-auto">
        <div className="mb-8 flex items-center justify-between">
          <Link to="/"><img src="/sls_logo_wide_color.png" alt="SuperLocalSEO" className="h-8 w-auto" /></Link>
          <button
            onClick={() => void handleFinish(true)}
            className="text-sm text-gray-400 hover:text-gray-600 hover:underline"
          >
            Finish later
          </button>
        </div>

        {/* Step indicator */}
        <div className="flex items-center gap-2 mb-8">
          {[1, 2].map((s) => (
            <div key={s} className="flex items-center gap-2">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold ${
                s < step ? 'bg-brand-500 text-white' :
                s === step ? 'bg-brand-500 text-white ring-4 ring-brand-50' :
                'bg-gray-200 text-gray-500'
              }`}>
                {s < step ? '✓' : s}
              </div>
              {s < TOTAL_STEPS && <div className={`h-0.5 w-12 ${s < step ? 'bg-brand-500' : 'bg-gray-200'}`} />}
            </div>
          ))}
          <span className="ml-3 text-sm text-gray-500">Step {step} of {TOTAL_STEPS}</span>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8">
          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>
          )}

          {/* ── Step 1: Business Info ── */}
          {step === 1 && (
            <div className="space-y-5">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Tell us about your business</h2>
                <p className="text-sm text-gray-500 mt-1">This takes about 2 minutes.</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Business Name *</label>
                <input type="text" value={businessName}
                  onChange={(e) => setBusinessName(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                  placeholder="Acme Plumbing" />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Industry</label>
                <select value={industry} onChange={(e) => setIndustry(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500">
                  <option value="">Select an industry</option>
                  {INDUSTRY_GROUPS.map(({ group, options }) => (
                    <optgroup key={group} label={group}>
                      {options.map((ind) => <option key={ind} value={ind}>{ind}</option>)}
                    </optgroup>
                  ))}
                </select>
                <p className="text-xs text-gray-400 mt-1">We'll auto-set your tracking keywords based on your industry.</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Address *</label>
                <input type="text" value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                  placeholder="123 Main St" />
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-1">
                  <label className="block text-sm font-medium text-gray-700 mb-1">City</label>
                  <input type="text" value={city} onChange={(e) => setCity(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                    placeholder="Tulsa" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">State</label>
                  <input type="text" value={state} onChange={(e) => setState(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                    placeholder="OK" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">ZIP</label>
                  <input type="text" value={zip} onChange={(e) => setZip(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                    placeholder="74103" />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
                <input type="text" value={phone} onChange={(e) => setPhone(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                  placeholder="+19185550100" />
              </div>

              <button
                onClick={() => void handleStep1Next()}
                disabled={saving || !businessName.trim() || !address.trim()}
                className="w-full bg-brand-500 text-white py-2.5 rounded-lg font-semibold text-sm hover:bg-brand-600 disabled:opacity-50 transition-colors"
              >
                {saving ? 'Saving...' : 'Next →'}
              </button>
            </div>
          )}

          {/* ── Step 2: Connect Google ── */}
          {step === 2 && (
            <div className="space-y-6">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Connect Google Business Profile</h2>
                <p className="text-sm text-gray-500 mt-1">
                  This pulls your reviews and ranking data directly from Google.
                </p>
              </div>

              <div className="bg-brand-50 border border-brand-100 rounded-xl p-4 text-sm text-brand-800">
                We've already set up your keyword tracking based on your industry. You'll start seeing ranking data within a few minutes of finishing setup.
              </div>

              <button
                onClick={() => void connectGoogle()}
                disabled={googleConnecting}
                className="w-full bg-brand-500 text-white py-2.5 rounded-lg font-semibold text-sm hover:bg-brand-600 disabled:opacity-50 transition-colors"
              >
                {googleConnecting ? 'Redirecting to Google...' : 'Connect Google →'}
              </button>

              <button
                onClick={() => void handleFinish(true)}
                className="w-full text-sm text-gray-400 hover:text-gray-600 py-2 hover:underline"
              >
                Skip for now — I'll connect later in Settings
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
```

---

## Part 16 — Frontend: App.tsx routing

### 16.1 Edit: `frontend/src/App.tsx`

Add the import and route for `OnboardingLite`:

```tsx
import OnboardingLite from './pages/OnboardingLite';

// Inside the ProtectedRoute block, add alongside the existing /onboarding route:
<Route path="/onboarding" element={<Onboarding />} />
<Route path="/onboarding/lite" element={<OnboardingLite />} />
```

---

## Part 17 — Frontend: Register.tsx (plan selection)

### 17.1 Edit: `frontend/src/pages/Register.tsx`

Add a `plan` query param read — if `?plan=lite` is in the URL, store it and pass it through to `/registered` state so BillingPage/onboarding can use it.

```tsx
const [searchParams] = useSearchParams();
const selectedPlan = (searchParams.get('plan') ?? 'lite') as 'lite' | 'pro';
// Default to 'lite' — lower friction entry point

// In onSubmit, after successful registration, navigate with plan in state:
navigate('/registered', { state: { email: data.email, plan: selectedPlan } });
```

**Add plan picker UI above the form (before the Google OAuth button):**

```tsx
{/* Plan selector */}
<div className="mb-6 grid grid-cols-2 gap-3">
  {(['lite', 'pro'] as const).map((p) => (
    <button
      key={p}
      type="button"
      onClick={() => { /* update URL param or local state */ }}
      className={`rounded-xl border-2 p-3 text-left transition-colors ${
        selectedPlan === p
          ? 'border-brand-500 bg-brand-50'
          : 'border-gray-200 hover:border-gray-300'
      }`}
    >
      <p className="font-semibold text-sm text-gray-900 capitalize">{p}</p>
      <p className="text-xs text-gray-500 mt-0.5">
        {p === 'lite' ? '$99/mo · 1 location' : '$350/mo + $499 setup'}
      </p>
    </button>
  ))}
</div>
```

**Pass `plan` to the `registerUser` call** — update `useAuth.register` to accept and store `plan` in `localStorage` (it's needed after the email verification redirect):

In `useAuthState.register`:
```typescript
const register = useCallback(async (email: string, password: string, businessName: string, plan?: string) => {
  const res = await apiFetch<...>('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email, password, businessName }),
  });
  if (!res.success) { throw ...; }
  // Store plan for post-verification use
  if (plan) localStorage.setItem('selectedPlan', plan);
}, []);
```

---

## Part 18 — Frontend: BillingPage.tsx (plan-aware checkout + upgrade CTA)

### 18.1 Edit: `frontend/src/pages/BillingPage.tsx`

**Read `productLine` from the billing status response** (we added it in Part 6).

**Update the `BillingStatus` interface:**
```typescript
interface BillingStatus {
  status: string;
  trialDaysLeft: number | null;
  locationsLimit: number;
  locationCount: number;
  currentPeriodEnd: string | null;
  publishableKey: string | null;
  productLine: 'lite' | 'pro';   // ← NEW
}
```

**Read the plan to use for new checkout:**
```typescript
// Read from localStorage (set at registration) OR from billing status for upgrades
const storedPlan = localStorage.getItem('selectedPlan') as 'lite' | 'pro' | null;
const planForCheckout = billing?.status === 'active'
  ? 'pro'          // upgrade flow always goes to Pro
  : (storedPlan ?? 'lite');  // new signups use stored plan, default lite
```

**Pass `plan` to `subscriptionIntent` API call:**
```typescript
const res = await apiFetch<IntentResponse>('/billing/subscription-intent', {
  method: 'POST',
  body: JSON.stringify({
    extraLocations: planForCheckout === 'lite' ? 0 : extraLocations,
    plan: planForCheckout,
    ...(promotionCodeId ? { promotionCodeId } : {}),
  }),
});
```

**Update the FEATURES list to be plan-aware:**
```typescript
const LITE_FEATURES = [
  'Daily rank tracking',
  'Review monitoring + AI replies',
  'Review request campaigns (email & SMS)',
  'Automated monthly PDF report',
  'Local competitor snapshot',
];

const PRO_FEATURES = [
  'Everything in Lite, plus:',
  'Unlimited locations',
  'Full competitor intelligence & gap analysis',
  'Citation health monitoring & builder',
  'ROI & revenue attribution dashboard',
  'Unlimited team members & roles',
  'QR review capture cards',
  'White-label reporting',
  'SEO audit history',
];

const features = planForCheckout === 'lite' ? LITE_FEATURES : PRO_FEATURES;
```

**Add upgrade CTA for active Lite subscribers** (shown when `billing.status === 'active' && billing.productLine === 'lite'`):

```tsx
{billing?.status === 'active' && billing.productLine === 'lite' && !proceedEarly && (
  <div className="mb-6 p-4 bg-brand-50 border border-brand-200 rounded-xl">
    <p className="text-sm font-semibold text-brand-800">You're on Lite</p>
    <p className="text-xs text-brand-600 mt-1 mb-3">
      Upgrade to Pro to unlock citations, competitor intelligence, team members, and multi-location tracking.
    </p>
    <button
      onClick={() => setProceedEarly(true)}
      className="text-xs font-semibold text-brand-700 hover:underline"
    >
      Upgrade to Pro →
    </button>
  </div>
)}
```

---

## Part 19 — Frontend: Audit page CTA defaults to Lite

### 19.1 Edit: `frontend/src/pages/Audit.tsx`

Find the registration link (line ~275):
```tsx
// BEFORE:
to={`/register?email=${encodeURIComponent(email)}&business=...`}

// AFTER:
to={`/register?email=${encodeURIComponent(email)}&business=...&plan=lite`}
```

---

## Part 20 — Type Safety Cleanup

After all edits, run TypeScript checks:

```bash
cd frontend && npx tsc --noEmit
cd backend && npx tsc --noEmit
```

Fix any type errors introduced by new parameters (particularly `plan` in Stripe service functions and `productLine` in the client response type).

---

## Summary of New/Edited Files

| File | Action | Purpose |
|---|---|---|
| `backend/src/db/migrations/YYYYMMDD_product_line.ts` | NEW | Adds `product_line` column |
| `backend/src/config.ts` | EDIT | Adds `liteBase` Stripe price |
| `.env.example` | EDIT | Documents new env var |
| `backend/src/middleware/requireProPlan.ts` | NEW | Gate middleware |
| `backend/src/routes/citations.ts` | EDIT | Apply gate to all routes |
| `backend/src/routes/competitors.ts` | EDIT | Gate all except `GET /` |
| `backend/src/routes/audits_bl.ts` | EDIT | Apply gate to all routes |
| `backend/src/services/stripe.service.ts` | EDIT | `plan` param on checkout/intent/webhook |
| `backend/src/controllers/billing.controller.ts` | EDIT | Pass `plan`, expose `productLine` in status |
| `backend/src/controllers/client.controller.ts` | EDIT | Expose `productLine` in `formatClient` |
| `frontend/src/hooks/useClient.ts` | NEW | `productLine`, `isLite`, `isPro` |
| `frontend/src/layouts/DashboardLayout.tsx` | EDIT | Plan-filtered nav, Lite onboarding redirect |
| `frontend/src/components/ProGate.tsx` | NEW | Locked feature placeholder |
| `frontend/src/pages/Competitors.tsx` | EDIT | Teaser view for Lite |
| `frontend/src/pages/Rankings.tsx` | EDIT | Hide CSV/sync/geo-grid for Lite |
| `frontend/src/pages/Dashboard.tsx` | EDIT | `LiteDashboard` 3-card view |
| `frontend/src/pages/Settings.tsx` | EDIT | Hide Team/QR/WhiteLabel tabs for Lite |
| `frontend/src/pages/OnboardingLite.tsx` | NEW | 2-step onboarding for Lite |
| `frontend/src/App.tsx` | EDIT | Add `/onboarding/lite` route |
| `frontend/src/pages/Register.tsx` | EDIT | Plan picker, pass `plan` param |
| `frontend/src/hooks/useAuth.ts` | EDIT | `register` accepts `plan`, stores in localStorage |
| `frontend/src/pages/BillingPage.tsx` | EDIT | Plan-aware checkout + upgrade CTA |
| `frontend/src/pages/Audit.tsx` | EDIT | Defaults post-audit CTA to `?plan=lite` |

---

## Execution Order for Claude Code

1. Run the DB migration first (Part 1) — everything else depends on the column existing.
2. Backend changes (Parts 2–7) — config, middleware, routes, Stripe, controllers.
3. Frontend hooks (Part 8) — `useClient` must exist before any component uses it.
4. Frontend components (Parts 9–15) — layout, ProGate, page edits, new pages.
5. Routing and register flow (Parts 16–19).
6. TypeScript check (Part 20).
7. Manual smoke test:
   - Create a new Lite account end-to-end: register → Lite onboarding → Lite dashboard
   - Verify Pro-only nav items are hidden
   - Verify Competitors teaser renders and blur overlay shows
   - Verify an existing Pro account still has full access
   - Verify upgrade flow on BillingPage works for an active Lite subscriber
