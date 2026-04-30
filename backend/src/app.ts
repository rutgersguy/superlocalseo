import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { requestLogger } from './middleware/requestLogger';
import { generalLimiter } from './middleware/rateLimit';
import { errorHandler } from './middleware/errorHandler';
import apiRouter from './routes/index';
import webhookRouter from './routes/webhooks';
import { config } from './config';

const app = express();

// Stripe webhook needs raw body — must come before json parser
app.use('/webhooks', express.raw({ type: 'application/json' }), webhookRouter);

app.use(helmet());
app.use(cors({
  origin: config.appUrl,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
}));
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());
app.use(requestLogger);
app.use(generalLimiter);

app.use('/api', apiRouter);

// 404
app.use((_req, res) => {
  res.status(404).json({ success: false, error: { message: 'Not found', code: 'NOT_FOUND' } });
});

app.use(errorHandler);

export default app;
