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

// Behind Cloudflare -> nginx. Without this, req.ip is the nginx container's
// address for EVERY request, so the rate limiters (which key on req.ip) would
// collapse all traffic onto one bucket and 429 the entire site after 100
// requests. nginx sets X-Forwarded-For to Cloudflare's CF-Connecting-IP, so a
// hop count of 1 resolves req.ip to the real client. See issue #161.
app.set('trust proxy', 1);

// Log first, so webhook traffic is visible. /webhooks was previously mounted
// ABOVE requestLogger, which meant inbound Stripe and EMR requests never
// appeared in the request log at all — the reason it was impossible to tell
// what EMR was actually sending, or whether it was sending anything (#148).
app.use(requestLogger);

// Webhooks need the RAW body for signature verification, so they must be
// mounted before express.json() (see the RAW_BODY_PATHS note below).
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
// Paths whose handlers need the RAW request body for signature verification.
//
// express.json() sets req._body = true, which makes any downstream express.raw()
// a no-op — so a route-level raw parser cannot rescue a path that this has
// already consumed. Stripe then receives a parsed object where it requires the
// original bytes and every signature check fails with:
//   "Webhook payload must be provided as a string or a Buffer ...
//    Signature verification is impossible without the original signed material."
//
// That is exactly what happened to /api/billing/webhook — the endpoint Stripe
// was actually configured to call — so NO Stripe event was ever processed in
// production and paying did not activate a plan (issue #147).
//
// /webhooks/* is already safe: it is mounted above with express.raw() BEFORE
// this line. This list covers the legacy path that is not.
const RAW_BODY_PATHS = new Set(['/api/billing/webhook']);

const jsonParser = express.json({ limit: '100kb' });
app.use((req, res, next) => {
  if (RAW_BODY_PATHS.has(req.path)) return next();
  return jsonParser(req, res, next);
});
app.use(cookieParser());
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
