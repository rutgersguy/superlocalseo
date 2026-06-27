import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { config } from '../config';
import { logger } from '../utils/logger';

/**
 * Verifies the HMAC-SHA256 signature on EmbedMyReviews webhooks
 * (POST /api/reviews/webhook). Without this the handler would write to the
 * reviews table from any unauthenticated caller.
 *
 * Signing scheme (per docs/INTEGRATIONS.md): HMAC-SHA256 of the JSON body using
 * EMBEDMYREVIEWS_WEBHOOK_SECRET, hex-encoded. EMR's exact header name is confirmed
 * at go-live — we accept both `x-emr-signature` and `x-embedmyreviews-signature`.
 *
 * Rollout: when the secret is configured we enforce strictly (401 on missing/bad
 * signature). When it is NOT configured we log a loud error and pass through, so
 * deploying this does not break live review ingestion before the secret is set —
 * BUT the endpoint stays unauthenticated until then. Set the secret to close it.
 */
export function verifyEmrWebhook(req: Request, res: Response, next: NextFunction): void {
  const secret = config.embedmyreviews.webhookSecret;

  if (!secret) {
    logger.error(
      'EMR webhook signature verification SKIPPED — EMBEDMYREVIEWS_WEBHOOK_SECRET is not set. '
      + 'POST /api/reviews/webhook is UNAUTHENTICATED. Set the secret (and configure it in the EMR dashboard) to enforce.',
    );
    next();
    return;
  }

  const provided = (req.headers['x-emr-signature'] ?? req.headers['x-embedmyreviews-signature']) as string | undefined;
  if (!provided) {
    res.status(401).json({ success: false, error: { code: 'INVALID_SIGNATURE', message: 'Missing webhook signature' } });
    return;
  }

  const expected = crypto.createHmac('sha256', secret).update(JSON.stringify(req.body)).digest('hex');
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  // timingSafeEqual throws on length mismatch — guard so a short/garbage sig is a clean 401.
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    logger.warn('EMR webhook signature invalid', { ip: req.ip });
    res.status(401).json({ success: false, error: { code: 'INVALID_SIGNATURE', message: 'Invalid webhook signature' } });
    return;
  }

  next();
}
