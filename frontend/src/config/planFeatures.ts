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
  { to: '/dashboard',             label: 'Dashboard',   icon: 'Home',          plans: ['lite', 'pro'] },
  { to: '/dashboard/rankings',    label: 'Rankings',    icon: 'BarChart2',     plans: ['lite', 'pro'] },
  { to: '/dashboard/reviews',     label: 'Reviews',     icon: 'Star',          plans: ['lite', 'pro'] },
  { to: '/dashboard/campaigns',   label: 'Campaigns',   icon: 'Megaphone',     plans: ['lite', 'pro'] },
  { to: '/dashboard/competitors', label: 'Competitors', icon: 'Users2',        plans: ['lite', 'pro'], teaserForLite: true },
  { to: '/dashboard/citations',   label: 'Citations',   icon: 'Link2',         plans: ['pro'] },
  { to: '/dashboard/audit',       label: 'SEO Audit',   icon: 'ClipboardList', plans: ['pro'] },
  { to: '/dashboard/reports',     label: 'Reports',     icon: 'FileText',      plans: ['lite', 'pro'] },
  { to: '/dashboard/settings',    label: 'Settings',    icon: 'Settings',      plans: ['lite', 'pro'] },
];

/**
 * Pro-only features INSIDE a page, as opposed to whole pages (NAV_ITEMS).
 *
 * This replaces `PRO_SETTINGS_TABS` and `LITE_RANKINGS_HIDDEN`, which were
 * imported by nothing and had keys that matched no code — the file said 'qr'
 * while Settings used 'qrcodes', and 'whitelabel' was not a tab at all. Pages
 * hardcoded their own `isLite` checks instead, which is how four Pro-marketed
 * surfaces ended up rendering for Lite (#157).
 *
 * Keep in step with `PLAN_ROUTE_GATES` in the backend map. Hiding a control
 * whose endpoint is not gated is theatre; gating an endpoint whose control is
 * still shown is a dead button. Both have shipped.
 */
export const PRO_FEATURES = [
  'csvExport',    // /reports/export/* and /analytics/export — sold as Pro (#157)
  'roiSettings',  // /analytics/roi
  'geoGrid',
  'manualSync',
  'teamMembers',
  'qrCodes',
] as const;

export type ProFeature = (typeof PRO_FEATURES)[number];

/**
 * Can this plan use this in-page feature?
 *
 * Deliberately typed to `ProFeature` rather than `string`. `canAccess()` below
 * defaults unknown keys to ALLOWED, which is why a new Pro surface stays
 * Lite-visible until somebody remembers to list it — `c49f60c` recorded
 * `/competitors/review-trend` nearly shipping free on exactly that. Here the
 * compiler refuses an unregistered key, so the omission cannot reach runtime.
 */
export function canUseFeature(plan: Plan, feature: ProFeature): boolean {
  return plan === 'pro' || !PRO_FEATURES.includes(feature);
}

/**
 * Can this plan reach this PAGE? Feature keys are NAV_ITEMS `to` paths or labels.
 *
 * ⚠️ Unlisted paths default to allowed, because most routes (auth, billing,
 * onboarding) are legitimately open and enumerating them all here would be its
 * own source of drift. For in-page controls use `canUseFeature`, which cannot be
 * called with an unregistered key.
 */
export function canAccess(plan: Plan, feature: string): boolean {
  if (plan === 'pro') return true;
  const navItem = NAV_ITEMS.find(
    (n) => n.to === feature || n.label.toLowerCase() === feature.toLowerCase(),
  );
  if (navItem) return navItem.plans.includes(plan);
  return true;
}
