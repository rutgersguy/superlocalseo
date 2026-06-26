import { Request, Response, NextFunction } from 'express';
import { isPlanAllowed, Plan } from '../config/planFeatures';
import { requireClient } from './requireClient';

/**
 * Plan-based access gate. Must be mounted AFTER requireClient at the index level
 * (requireClient runs requireAuth internally and populates req.client + req.userRole).
 *
 * Uses isPlanAllowed() from the central capability map — no manual per-route logic.
 * Zero extra DB reads: reuses req.client populated upstream.
 */
export function requireProPlan(req: Request, res: Response, next: NextFunction): void {
  // Admins always bypass (requireAuth sets req.userRole, NOT req.user.role)
  if (req.userRole === 'admin') { next(); return; }

  const productLine = ((req.client?.product_line as string | null) ?? 'pro') as Plan;
  if (productLine === 'pro') { next(); return; }

  // req.baseUrl carries the mount prefix (e.g. "/api/citations"); req.path is mount-relative.
  // Combine them, strip the leading "/api/", and trim any trailing slash.
  const apiPath = `${req.baseUrl}${req.path}`
    .replace(/^\/api\//, '')
    .replace(/\/+$/, '');

  // Special case: POST /competitors creates a competitor — mapped to __create__ sub-path.
  const normalizedPath = (req.method === 'POST' && apiPath === 'competitors')
    ? 'competitors/__create__'
    : apiPath;

  if (isPlanAllowed(normalizedPath, productLine)) { next(); return; }

  res.status(403).json({
    success: false,
    error: { code: 'PRO_REQUIRED', message: 'This feature requires the Pro plan.' },
  });
}

/**
 * Index-level orchestrator: populate the client (for authenticated requests),
 * then enforce the plan gate. Mounted once per gated route prefix in routes/index.ts.
 *
 * Anonymous requests (no Bearer token) pass straight through — public subroutes
 * such as external provider webhooks live under gated prefixes (e.g.
 * POST /api/reviews/webhook) and must stay reachable. Protected handlers still
 * enforce auth via their own per-route requireAuth, so passthrough is safe.
 *
 * ⚠️ SECURITY INVARIANT: this gate does NOT authenticate. Every handler under a
 * gated prefix (see subscriptionRoutes in routes/index.ts) MUST run its own
 * requireAuth — a tokenless request reaches the child router. Only deliberately
 * public endpoints (signed webhooks) may omit requireAuth. If you add a Pro route,
 * add requireAuth to it; do not rely on this gate to block anonymous access.
 *
 * For authenticated requests, requireClient populates req.client (+ runs the
 * billing check); its idempotency guard means the per-route requireClient inside
 * each child router short-circuits, so this adds zero net DB queries.
 */
export async function enforcePlanGate(req: Request, res: Response, next: NextFunction): Promise<void> {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) { next(); return; }

  await new Promise<void>((resolve) => requireClient(req, res, () => resolve()));
  if (res.headersSent) return; // requireClient already responded (401 / 402 / 404)

  requireProPlan(req, res, next);
}
