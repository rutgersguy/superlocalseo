import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { db } from '../db/connection';
import { ok, noContent, notFound, err } from '../utils/response';
import { encrypt, decrypt } from '../utils/crypto';
import { validateApiKey as blValidate } from '../services/brightlocal.service';
import { validateApiKey as emrValidate, registerWebhook } from '../services/embedmyreviews.service';
import { config } from '../config';
import { rankingsQueue, citationsQueue } from '../jobs/queue';
import { logger } from '../utils/logger';

export const brightlocalSchema = z.object({
  apiKey: z.string().min(1),
});

export const embedmyreviewsSchema = z.object({
  apiKey: z.string().min(1),
});

type BrightLocalBody = z.infer<typeof brightlocalSchema>;
type EmbedMyReviewsBody = z.infer<typeof embedmyreviewsSchema>;

function maskApiKey(decrypted: string): string {
  if (decrypted.length <= 4) return '****';
  return `****${decrypted.slice(-4)}`;
}

function formatIntegration(integration: Record<string, unknown>, maskedKey: string) {
  return {
    id: integration.id,
    provider: integration.provider,
    status: integration.status,
    maskedApiKey: maskedKey,
    lastPullAt: integration.last_pull_at,
    errorMessage: integration.error_message,
    createdAt: integration.created_at,
  };
}

export async function list(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const integrations = await db('integrations').where({ client_id: req.clientId });

    const formatted = integrations.map((integration) => {
      let maskedKey = '****';
      if (integration.api_key_encrypted) {
        try {
          const decrypted = decrypt(integration.api_key_encrypted as string);
          maskedKey = maskApiKey(decrypted);
        } catch {
          maskedKey = '****';
        }
      }
      return formatIntegration(integration as Record<string, unknown>, maskedKey);
    });

    ok(res, formatted);
  } catch (e) {
    next(e);
  }
}

export async function connectBrightLocal(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { apiKey } = req.body as BrightLocalBody;

    const valid = await blValidate(apiKey);
    if (!valid) {
      err(res, 'Invalid BrightLocal API key', 400, 'INVALID_API_KEY');
      return;
    }

    const encrypted = encrypt(apiKey);
    const now = new Date();

    const existing = await db('integrations').where({ client_id: req.clientId, provider: 'brightlocal' }).first();

    let integration: Record<string, unknown>;
    if (existing) {
      const [updated] = await db('integrations')
        .where({ id: existing.id })
        .update({ api_key_encrypted: encrypted, status: 'connected', error_message: null, updated_at: now })
        .returning('*');
      integration = updated as Record<string, unknown>;
    } else {
      const [inserted] = await db('integrations').insert({
        client_id: req.clientId,
        provider: 'brightlocal',
        api_key_encrypted: encrypted,
        status: 'connected',
        created_at: now,
        updated_at: now,
      }).returning('*');
      integration = inserted as Record<string, unknown>;
    }

    // Trigger initial data pull
    rankingsQueue.add('initial-pull', { clientId: req.clientId }).catch((e) =>
      logger.error('Failed to queue initial rankings pull', { error: (e as Error).message }),
    );
    citationsQueue.add('initial-pull', { clientId: req.clientId }).catch((e) =>
      logger.error('Failed to queue initial citations pull', { error: (e as Error).message }),
    );

    ok(res, formatIntegration(integration, maskApiKey(apiKey)));
  } catch (e) {
    next(e);
  }
}

export async function connectEmbedMyReviews(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { apiKey } = req.body as EmbedMyReviewsBody;

    const valid = await emrValidate(apiKey);
    if (!valid) {
      err(res, 'Invalid EmbedMyReviews API key', 400, 'INVALID_API_KEY');
      return;
    }

    const encrypted = encrypt(apiKey);
    const now = new Date();

    // Register webhook
    const webhookUrl = `${config.appUrl}/api/reviews/webhook`;
    await registerWebhook(apiKey, webhookUrl).catch((e) =>
      logger.warn('Failed to register EmbedMyReviews webhook', { error: (e as Error).message }),
    );

    const existing = await db('integrations').where({ client_id: req.clientId, provider: 'embedmyreviews' }).first();

    let integration: Record<string, unknown>;
    if (existing) {
      const [updated] = await db('integrations')
        .where({ id: existing.id })
        .update({ api_key_encrypted: encrypted, status: 'connected', error_message: null, updated_at: now })
        .returning('*');
      integration = updated as Record<string, unknown>;
    } else {
      const [inserted] = await db('integrations').insert({
        client_id: req.clientId,
        provider: 'embedmyreviews',
        api_key_encrypted: encrypted,
        status: 'connected',
        created_at: now,
        updated_at: now,
      }).returning('*');
      integration = inserted as Record<string, unknown>;
    }

    ok(res, formatIntegration(integration, maskApiKey(apiKey)));
  } catch (e) {
    next(e);
  }
}

export async function disconnect(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { provider } = req.params;

    const integration = await db('integrations').where({ client_id: req.clientId, provider }).first();
    if (!integration) {
      notFound(res, 'Integration not found');
      return;
    }

    await db('integrations')
      .where({ id: integration.id })
      .update({ status: 'disconnected', api_key_encrypted: null, updated_at: new Date() });

    noContent(res);
  } catch (e) {
    next(e);
  }
}
