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

/** Settings tabs that are Pro-only */
export const PRO_SETTINGS_TABS = ['team', 'qr', 'whitelabel'] as const;

/** Rankings page features hidden for Lite */
export const LITE_RANKINGS_HIDDEN = ['csvExport', 'manualSync', 'roiColumn', 'geoGrid'] as const;

/**
 * Returns true if the given plan can access the given feature key.
 * Feature keys match the NAV_ITEMS `to` paths or the NAV_ITEMS label.
 */
export function canAccess(plan: Plan, feature: string): boolean {
  if (plan === 'pro') return true;
  const navItem = NAV_ITEMS.find(
    (n) => n.to === feature || n.label.toLowerCase() === feature.toLowerCase(),
  );
  if (navItem) return navItem.plans.includes(plan);
  return true; // unlisted features are open
}
