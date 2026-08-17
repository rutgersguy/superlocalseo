import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { config } from '../config';
import { logger } from '../utils/logger';

/**
 * Authenticates EmbedMyReviews webhooks (POST /api/reviews/webhook). Without this
 * the handler would write to the reviews table from any unauthenticated caller.
 *
 * EMR publishes no webhook signing secret or signature header (their webhook docs are
 * unfinished, and the dashboard only lets you enter a destination URL). So the primary
 * auth is a shared token WE control, sent either as a `?token=` query param on the
 * registered webhook URL or an `X-Webhook-Token` header — configured via
 * EMBEDMYREVIEWS_WEBHOOK_TOKEN. This works regardless of EMR's (absent) signing support.
 *
 * A legacy HMAC-SHA256 path (EMBEDMYREVIEWS_WEBHOOK_SECRET) is kept in case EMR ever
 * documents real signing; it is only consulted when no token is configured.
 *
 * Rollout: when neither a token nor a secret is configured we log a loud error and pass
 * through, so deploying this never breaks live ingestion before the token is set — BUT
 * the endpoint stays unauthenticated until then. Register the tokenized URL in EMR and
 * set EMBEDMYREVIEWS_WEBHOOK_TOKEN to close it.
 */

/** Constant-time string comparison that is safe against length-mismatch throws. */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

export function verifyEmrWebhook(req: Request, res: Response, next: NextFunction): void {
  const token = config.embedmyreviews.webhookToken;
  const secret = config.embedmyreviews.webhookSecret;

  // Primary: shared token (query param or header).
  if (token) {
    const fromQuery = typeof req.query.token === 'string' ? req.query.token : undefined;
    const fromHeader = req.headers['x-webhook-token'] as string | undefined;
    const provided = fromQuery ?? fromHeader;
    if (!provided || !safeEqual(provided, token)) {
      logger.warn('EMR webhook token invalid or missing', { ip: req.ip });
      res.status(401).json({ success: false, error: { code: 'INVALID_TOKEN', message: 'Invalid or missing webhook token' } });
      return;
    }
    next();
    return;
  }

  // Legacy fallback: HMAC-SHA256 of the JSON body, hex-encoded, in x-emr-signature.
  if (secret) {
    const provided = (req.headers['x-emr-signature'] ?? req.headers['x-embedmyreviews-signature']) as string | undefined;
    if (!provided) {
      res.status(401).json({ success: false, error: { code: 'INVALID_SIGNATURE', message: 'Missing webhook signature' } });
      return;
    }
    const expected = crypto.createHmac('sha256', secret).update(JSON.stringify(req.body)).digest('hex');
    if (!safeEqual(provided, expected)) {
      logger.warn('EMR webhook signature invalid', { ip: req.ip });
      res.status(401).json({ success: false, error: { code: 'INVALID_SIGNATURE', message: 'Invalid webhook signature' } });
      return;
    }
    next();
    return;
  }

  // Neither configured — the endpoint is open. Log loudly and pass through so we do not
  // drop live review ingestion, but this MUST be closed by setting the token.
  logger.error(
    'EMR webhook verification SKIPPED — neither EMBEDMYREVIEWS_WEBHOOK_TOKEN nor _SECRET is set. '
    + 'POST /webhooks/emr and POST /api/reviews/webhook are UNAUTHENTICATED. Set '
    + 'EMBEDMYREVIEWS_WEBHOOK_TOKEN (and append '
    + '?token=<value> to the webhook URL registered in EMR) to enforce.',
  );
  next();
}
