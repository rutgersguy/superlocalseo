import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../db/connection';
import { ok, notFound, err } from '../utils/response';

const DEFAULT_CONFIG = { theme: 'light', minRating: 4, maxCount: 8, showPlatformBadge: true };

const configSchema = z.object({
  theme: z.enum(['light', 'dark']).optional(),
  minRating: z.number().int().min(1).max(5).optional(),
  maxCount: z.number().int().min(1).max(20).optional(),
  showPlatformBadge: z.boolean().optional(),
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// PUBLIC — no auth. Called by the embeddable widget.js from any domain.
export async function publicWidget(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { key } = req.params;

    if (!UUID_RE.test(key)) {
      notFound(res, 'Widget not found');
      return;
    }

    const client = await db('clients').where({ widget_key: key }).first();
    if (!client) {
      notFound(res, 'Widget not found');
      return;
    }

    const cfg = { ...DEFAULT_CONFIG, ...(client.widget_config as object ?? {}) };

    const reviews = await db('reviews')
      .where({ client_id: client.id })
      .where('rating', '>=', cfg.minRating)
      .whereNotNull('body')
      .orderBy('review_date', 'desc')
      .limit(cfg.maxCount)
      .select('author_name', 'rating', 'body', 'platform', 'review_date', 'platform_url');

    // CORS — open, widget is embedded on third-party sites
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

    ok(res, {
      businessName: client.business_name as string,
      config: cfg,
      reviews: reviews.map((r) => ({
        authorName: r.author_name,
        rating: r.rating,
        body: r.body,
        platform: r.platform,
        reviewDate: r.review_date,
        platformUrl: r.platform_url ?? null,
      })),
    });
  } catch (e) {
    next(e);
  }
}

// AUTHENTICATED — returns the client's widget key + config (generates key if missing)
export async function getWidget(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    let client = req.client as Record<string, unknown>;

    if (!client.widget_key) {
      const [updated] = await db('clients')
        .where({ id: req.clientId })
        .update({
          widget_key: uuidv4(),
          widget_config: DEFAULT_CONFIG,
          updated_at: new Date(),
        })
        .returning('*');
      client = updated as Record<string, unknown>;
    }

    let widget = await db('client_widgets').where({ client_id: req.clientId }).first();
    if (!widget) {
      const [created] = await db('client_widgets')
        .insert({ client_id: req.clientId, config: JSON.stringify({}), created_at: new Date(), updated_at: new Date() })
        .returning('*');
      widget = created;
    }

    ok(res, {
      id: widget.id,
      widgetKey: client.widget_key,
      config: { ...DEFAULT_CONFIG, ...(client.widget_config as object ?? {}) },
    });
  } catch (e) {
    next(e);
  }
}

// AUTHENTICATED — update widget config
export async function updateWidget(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const updates = configSchema.parse(req.body);

    const client = req.client as Record<string, unknown>;
    const current = { ...DEFAULT_CONFIG, ...(client.widget_config as object ?? {}) };
    const merged = { ...current, ...updates };

    await db('clients').where({ id: req.clientId }).update({
      widget_config: merged,
      updated_at: new Date(),
    });

    ok(res, { config: merged });
  } catch (e) {
    next(e);
  }
}

// AUTHENTICATED — regenerate widget key (invalidates old embeds)
export async function regenerateKey(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const newKey = uuidv4();
    await db('clients').where({ id: req.clientId }).update({
      widget_key: newKey,
      updated_at: new Date(),
    });
    ok(res, { widgetKey: newKey });
  } catch (e) {
    next(e);
  }
}

export async function getConfig(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = req.params;
    const widget = await db('client_widgets').where({ id, client_id: req.clientId }).first();
    if (!widget) { err(res, 'Widget not found', 404, 'NOT_FOUND'); return; }
    ok(res, { config: widget.config ?? {} });
  } catch (e) { next(e); }
}

export async function updateConfig(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = req.params;
    const widget = await db('client_widgets').where({ id, client_id: req.clientId }).first();
    if (!widget) { err(res, 'Widget not found', 404, 'NOT_FOUND'); return; }

    const advancedConfigSchema = z.object({
      minRating: z.number().int().min(1).max(5).optional(),
      platforms: z.array(z.string()).optional(),
      keywordFilter: z.string().max(100).optional(),
      sortBy: z.enum(['newest', 'highest', 'lowest']).optional(),
      reviewCount: z.number().int().min(1).max(50).optional(),
      customCss: z.string().max(10000).optional().refine(
        (css) => !css || !/(javascript:|@import|expression\s*\()/i.test(css),
        'CSS contains disallowed content'
      ),
    });

    const parsed = advancedConfigSchema.safeParse(req.body);
    if (!parsed.success) { err(res, parsed.error.errors[0]?.message ?? 'Validation error', 400, 'VALIDATION_ERROR'); return; }

    const currentConfig = (widget.config ?? {}) as Record<string, unknown>;
    const newConfig = { ...currentConfig, ...parsed.data };

    await db('client_widgets').where({ id }).update({ config: JSON.stringify(newConfig), updated_at: new Date() });
    ok(res, { config: newConfig });
  } catch (e) { next(e); }
}
