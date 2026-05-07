import * as Sentry from '@sentry/node';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { requestLogger } from './middleware/requestLogger';
import { generalLimiter } from './middleware/rateLimit';
import { errorHandler } from './middleware/errorHandler';
import { httpMetricsMiddleware } from './middleware/metrics';
import apiRouter from './routes/index';
import webhookRouter from './routes/webhooks';
import { config } from './config';

if (config.sentry.dsn) {
  Sentry.init({ dsn: config.sentry.dsn, environment: config.env, tracesSampleRate: 0.1 });
}

const app = express();
app.disable('etag'); // prevent 304s on authenticated API responses

// Stripe webhook needs raw body — must come before json parser
app.use('/webhooks', express.raw({ type: 'application/json' }), webhookRouter);

app.use(helmet());
const allowedOrigins = new Set([
  config.appUrl,
  'http://localhost:5173',
  'https://superlocalseo.com',
  'https://www.superlocalseo.com',
]);
app.use(cors({
  origin: (origin, cb) => cb(null, !origin || allowedOrigins.has(origin)),
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
}));
app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());
app.use(requestLogger);
app.use(httpMetricsMiddleware);
app.use(generalLimiter);

app.use('/api', apiRouter);

// 404
app.use((_req, res) => {
  res.status(404).json({ success: false, error: { message: 'Not found', code: 'NOT_FOUND' } });
});

// Sentry error handler must come after routes
if (config.sentry.dsn) {
  Sentry.setupExpressErrorHandler(app);
}

app.use(errorHandler);

export default app;
