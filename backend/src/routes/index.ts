import { Router } from 'express';
import healthRouter from './health';
import authRouter from './auth';
import clientsRouter from './clients';
import locationsRouter from './locations';
import keywordsRouter from './keywords';
import integrationsRouter from './integrations';
import rankingsRouter from './rankings';
import citationsRouter from './citations';
import reviewsRouter from './reviews';
import metricsRouter from './metrics';
import billingRouter from './billing';
import reportsRouter from './reports';
import analyticsRouter from './analytics';
import auditRouter from './audit';
import teamRouter from './team';
import widgetRouter from './widget';
import campaignsRouter from './campaigns';
import competitorsRouter from './competitors';
import qrRouter from './qr';
import auditsBlRouter from './audits_bl';
import reputationRouter from './reputation';
import geoGridRouter from './geogrid';
import adminRouter from './admin';
import placesRouter from './places';
import { enforcePlanGate } from '../middleware/requireProPlan';

const router = Router();

// Public / always-accessible routes
router.use('/health', healthRouter);
router.use('/auth', authRouter);
router.use('/billing', billingRouter);
router.use('/audit', auditRouter);
router.use('/widget', widgetRouter);
router.use('/places', placesRouter);
router.use('/metrics', metricsRouter);

// Accessible during trial (no paywall needed for account management)
router.use('/clients', clientsRouter);
router.use('/locations', locationsRouter);
router.use('/integrations', integrationsRouter);
router.use('/admin', adminRouter);

// Team & QR — accessible during trial but Pro-only. enforcePlanGate populates the
// client (authenticated requests) and enforces the plan; per-route requireClient
// already runs the billing check, and its idempotency guard avoids a double query.
router.use('/team', enforcePlanGate, teamRouter);
router.use('/qr', enforcePlanGate, qrRouter);

// Subscription + plan gated routes. enforcePlanGate is applied once per prefix:
// - anonymous requests (e.g. POST /api/reviews/webhook) pass through; the public
//   handler runs and protected handlers still 401 via their own requireAuth.
// - authenticated requests get req.client populated, then requireProPlan enforces
//   the central capability map. Billing is enforced by requireClient.checkBillingAccess
//   (the same per-route check as before — the old index-level requireActiveSubscription
//   was a no-op here because req.userId is not populated until per-route requireAuth).
// New routes added under these prefixes are gated automatically — fail-safe.
const subscriptionRoutes = [
  ['/keywords', keywordsRouter],
  ['/rankings', rankingsRouter],
  ['/citations', citationsRouter],
  ['/reviews', reviewsRouter],
  ['/reports', reportsRouter],
  ['/analytics', analyticsRouter],
  ['/campaigns', campaignsRouter],
  ['/competitors', competitorsRouter],
  ['/audits/bl', auditsBlRouter],
  ['/reputation', reputationRouter],
  ['/geo-grid', geoGridRouter],
] as const;

for (const [path, routerModule] of subscriptionRoutes) {
  router.use(path, enforcePlanGate, routerModule);
}

export default router;
