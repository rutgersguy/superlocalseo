import { Request, Response, NextFunction } from 'express';
import client from 'prom-client';

// Default Node.js + process metrics (GC, memory, event loop lag, etc.)
client.collectDefaultMetrics({ prefix: 'sls_' });

export const httpRequestDuration = new client.Histogram({
  name: 'sls_http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.01, 0.05, 0.1, 0.3, 0.5, 1, 2, 5],
});

export const httpRequestTotal = new client.Counter({
  name: 'sls_http_requests_total',
  help: 'Total HTTP requests',
  labelNames: ['method', 'route', 'status_code'],
});

export const registry = client.register;

export function httpMetricsMiddleware(req: Request, res: Response, next: NextFunction): void {
  const start = process.hrtime.bigint();

  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - start) / 1e9;
    // Collapse IDs in path to avoid high cardinality (e.g. /reviews/abc-123 → /reviews/:id)
    const route = req.route?.path ?? req.path.replace(/\/[0-9a-f-]{8,}/gi, '/:id');
    const labels = {
      method: req.method,
      route,
      status_code: String(res.statusCode),
    };
    httpRequestDuration.observe(labels, durationMs);
    httpRequestTotal.inc(labels);
  });

  next();
}
