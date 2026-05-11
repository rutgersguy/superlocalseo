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
import { requireActiveSubscription } from '../middleware/requireActiveSubscription';

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
router.use('/team', teamRouter);
router.use('/qr', qrRouter);
router.use('/admin', adminRouter);

// Subscription-gated routes — blocked after trial expires / payment failure
router.use('/keywords', requireActiveSubscription, keywordsRouter);
router.use('/rankings', requireActiveSubscription, rankingsRouter);
router.use('/citations', requireActiveSubscription, citationsRouter);
router.use('/reviews', requireActiveSubscription, reviewsRouter);
router.use('/reports', requireActiveSubscription, reportsRouter);
router.use('/analytics', requireActiveSubscription, analyticsRouter);
router.use('/campaigns', requireActiveSubscription, campaignsRouter);
router.use('/competitors', requireActiveSubscription, competitorsRouter);
router.use('/audits/bl', requireActiveSubscription, auditsBlRouter);
router.use('/reputation', requireActiveSubscription, reputationRouter);
router.use('/geo-grid', requireActiveSubscription, geoGridRouter);

export default router;
