/**
 * Central plan capability map.
 * Backend: consumed by requireProPlan middleware via route prefix matching.
 * Frontend: the same data structure is duplicated in frontend/src/config/planFeatures.ts
 *           (can't be shared directly across workspaces without a monorepo setup).
 *
 * HOW IT WORKS — default-allow for unlisted, explicit-deny for listed:
 * - Any route NOT listed here is implicitly Lite-accessible (public/auth/billing etc.)
 * - Any route listed here with plans: ['pro'] is blocked for Lite
 * - Any route listed here with plans: ['lite', 'pro'] is open to both
 *
 * Matching is prefix-based: 'citations' matches /api/citations, /api/citations/scan, etc.
 * For competitors/analytics/rankings, sub-path overrides apply (more specific path wins).
 */

export type Plan = 'lite' | 'pro';

export interface RouteGate {
  /** API route prefix (without the /api/ prefix) */
  prefix: string;
  plans: Plan[];
  /** Optional: sub-path overrides (more specific prefix wins over parent) */
  subPaths?: Array<{ path: string; plans: Plan[] }>;
}

export const PLAN_ROUTE_GATES: RouteGate[] = [
  // ── Blocked entirely for Lite ──────────────────────────────────────────────
  { prefix: 'citations',  plans: ['pro'] },
  { prefix: 'geo-grid',   plans: ['pro'] },
  { prefix: 'audits/bl',  plans: ['pro'] },
  { prefix: 'reputation', plans: ['pro'] },
  { prefix: 'team',       plans: ['pro'] },
  { prefix: 'qr',         plans: ['pro'] },

  // ── Competitors: base list open for Lite (teaser), sub-routes Pro-only ─────
  {
    prefix: 'competitors',
    plans: ['lite', 'pro'], // GET /competitors allowed for Lite (teaser data)
    subPaths: [
      { path: 'competitors/gap',               plans: ['pro'] },
      { path: 'competitors/head-to-head',      plans: ['pro'] },
      { path: 'competitors/search',            plans: ['pro'] },
      { path: 'competitors/sync-rankings',     plans: ['pro'] },
      { path: 'competitors/discover-keywords', plans: ['pro'] },
      // POST /competitors (add competitor) — Pro only (mapped to __create__ in middleware)
      { path: 'competitors/__create__',        plans: ['pro'] },
    ],
  },

  // ── Analytics: trend endpoints open, exports and rankings data Pro-only ────
  {
    prefix: 'analytics',
    plans: ['lite', 'pro'],
    subPaths: [
      { path: 'analytics/rankings', plans: ['pro'] },
      { path: 'analytics/export',   plans: ['pro'] },
      { path: 'analytics/roi',      plans: ['pro'] },
    ],
  },

  // ── Rankings: read open for Lite, writes/exports Pro-only ─────────────────
  {
    prefix: 'rankings',
    plans: ['lite', 'pro'],
    subPaths: [
      { path: 'rankings/export', plans: ['pro'] },
      // Lite is allowed through the route gate but gets exactly ONE manual scan ever
      // (enforced in ranking.controller via clients.manual_scan_used_at) so a new Lite
      // client isn't stuck waiting for the nightly job to see any data. Pro keeps the
      // rolling 24h refresh.
      { path: 'rankings/sync',   plans: ['lite', 'pro'] },
    ],
  },
];

/**
 * Given an API path (e.g. "competitors/gap") and a product_line,
 * returns true if the plan is allowed to access that path.
 *
 * Used directly in middleware. Exported here so tests can import it independently.
 */
export function isPlanAllowed(apiPath: string, productLine: Plan): boolean {
  if (productLine === 'pro') return true; // Pro always passes

  // Normalize: strip leading slash
  const path = apiPath.replace(/^\//, '');

  for (const gate of PLAN_ROUTE_GATES) {
    // Check sub-path overrides first (more specific wins)
    if (gate.subPaths) {
      for (const sub of gate.subPaths) {
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
