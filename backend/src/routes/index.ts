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

const router = Router();

router.use('/health', healthRouter);
router.use('/auth', authRouter);
router.use('/clients', clientsRouter);
router.use('/locations', locationsRouter);
router.use('/keywords', keywordsRouter);
router.use('/integrations', integrationsRouter);
router.use('/rankings', rankingsRouter);
router.use('/citations', citationsRouter);
router.use('/reviews', reviewsRouter);
router.use('/metrics', metricsRouter);
router.use('/billing', billingRouter);
router.use('/reports', reportsRouter);

export default router;
