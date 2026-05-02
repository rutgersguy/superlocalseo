import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { db } from '../db/connection';
import { ok, err } from '../utils/response';
import { sendInvite, fetchUnsubscribes, fetchCredits, fetchCampaignTemplates, createCampaign as createEMRCampaign } from '../services/embedmyreviews.service';
import { getClientEMRKey } from '../services/emr_provisioning';
import { logger } from '../utils/logger';

export async function list(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const campaigns = await db('emr_campaigns')
      .where({ client_id: req.clientId })
      .orderBy('name', 'asc');

    ok(res, {
      campaigns: campaigns.map((c) => ({
        id: c.id,
        emrCampaignId: c.emr_campaign_id,
        name: c.name,
        invited: c.invited,
        opened: c.opened,
        clicked: c.clicked,
        reviewed: c.reviewed,
        privateFeedback: c.private_feedback,
        unsubscribed: c.unsubscribed,
        metricsPulledAt: c.metrics_pulled_at,
      })),
    });
  } catch (e) {
    next(e);
  }
}

export async function create(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { name, templateId } = req.body as { name?: string; templateId?: string };
    if (!name?.trim()) {
      err(res, 'Campaign name required', 400, 'VALIDATION_ERROR');
      return;
    }

    const apiKey = await getClientEMRKey(req.clientId);
    if (!apiKey) {
      err(res, 'EmbedMyReviews integration not connected. Connect your account in Settings → Integrations.', 400, 'NOT_CONNECTED');
      return;
    }

    let emrCampaign: { id: string; name: string };
    try {
      emrCampaign = await createEMRCampaign(apiKey, name.trim(), templateId);
    } catch (e) {
      logger.warn('EMR createCampaign failed', { clientId: req.clientId, error: (e as Error).message });
      err(res, 'Could not reach the review platform. Please try again in a moment.', 503, 'EMR_UNAVAILABLE');
      return;
    }

    const [campaign] = await db('emr_campaigns')
      .insert({ client_id: req.clientId, emr_campaign_id: emrCampaign.id, name: emrCampaign.name })
      .returning('*');

    ok(res, {
      campaign: {
        id: campaign.id,
        emrCampaignId: emrCampaign.id,
        name: emrCampaign.name,
        invited: 0, opened: 0, clicked: 0, reviewed: 0, privateFeedback: 0, unsubscribed: 0,
        metricsPulledAt: null,
      },
    });
  } catch (e) {
    next(e);
  }
}

const inviteSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().optional(),
  email: z.string().email().optional(),
  phone: z.string().min(7).optional(),
}).refine((d) => d.email || d.phone, { message: 'email or phone required' });

export async function invite(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { campaignId } = req.params;

    const parsed = inviteSchema.safeParse(req.body);
    if (!parsed.success) {
      err(res, parsed.error.errors[0]?.message ?? 'Validation error', 400, 'VALIDATION_ERROR');
      return;
    }

    const apiKey = await getApiKey(req.clientId);
    if (!apiKey) {
      err(res, 'EmbedMyReviews integration not connected', 400, 'NOT_CONNECTED');
      return;
    }

    const campaign = await db('emr_campaigns')
      .where({ client_id: req.clientId, emr_campaign_id: campaignId })
      .first();
    if (!campaign) {
      err(res, 'Campaign not found', 404, 'NOT_FOUND');
      return;
    }

    await sendInvite(apiKey, campaignId, parsed.data);

    ok(res, { sent: 1 });
  } catch (e) {
    next(e);
  }
}

const bulkSchema = z.object({
  contacts: z.array(
    z.object({
      firstName: z.string().min(1),
      lastName: z.string().optional(),
      email: z.string().email().optional(),
      phone: z.string().min(7).optional(),
    }).refine((d) => d.email || d.phone, { message: 'each contact needs email or phone' })
  ).min(1).max(500),
});

export async function bulkInvite(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { campaignId } = req.params;

    const parsed = bulkSchema.safeParse(req.body);
    if (!parsed.success) {
      err(res, parsed.error.errors[0]?.message ?? 'Validation error', 400, 'VALIDATION_ERROR');
      return;
    }

    const apiKey = await getApiKey(req.clientId);
    if (!apiKey) {
      err(res, 'EmbedMyReviews integration not connected', 400, 'NOT_CONNECTED');
      return;
    }

    const campaign = await db('emr_campaigns')
      .where({ client_id: req.clientId, emr_campaign_id: campaignId })
      .first();
    if (!campaign) {
      err(res, 'Campaign not found', 404, 'NOT_FOUND');
      return;
    }

    const contacts = parsed.data.contacts;
    let sent = 0;
    let skipped = 0;
    const failures: Array<{ index: number; error: string }> = [];

    let unsubscribedContacts = new Set<string>();
    try {
      const unsub = await fetchUnsubscribes(apiKey, {});
      unsubscribedContacts = new Set(unsub.unsubscribes.map((u) => u.contact.toLowerCase()));
    } catch {
      // non-fatal
    }

    for (let i = 0; i < contacts.length; i++) {
      const contactKey = (contacts[i].email ?? contacts[i].phone ?? '').toLowerCase();
      if (unsubscribedContacts.has(contactKey)) {
        failures.push({ index: i, error: 'Contact has unsubscribed' });
        skipped++;
        continue;
      }
      try {
        await sendInvite(apiKey, campaignId, contacts[i]);
        sent++;
      } catch (e) {
        failures.push({ index: i, error: (e as Error).message });
        logger.warn('Bulk invite failed for contact', { index: i, error: (e as Error).message });
      }
    }

    ok(res, { sent, failed: failures.length - skipped, skipped, failures });
  } catch (e) {
    next(e);
  }
}

export async function listUnsubscribes(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const apiKey = await getApiKey(req.clientId);
    if (!apiKey) {
      ok(res, { unsubscribes: [], total: 0, hasMore: false });
      return;
    }
    const page = Math.max(1, parseInt(String(req.query.page ?? '1'), 10));
    try {
      const result = await fetchUnsubscribes(apiKey, { page });
      ok(res, {
        unsubscribes: result.unsubscribes.map((u) => ({
          ...u,
          contact: maskContact(u.contact, u.type),
        })),
        total: result.total,
        hasMore: result.hasMore,
      });
    } catch {
      ok(res, { unsubscribes: [], total: 0, hasMore: false });
    }
  } catch (e) {
    next(e);
  }
}

function maskContact(contact: string, type: 'email' | 'sms'): string {
  if (type === 'email') {
    const [local, domain] = contact.split('@');
    if (!local || !domain) return '***';
    return `${local[0]}***@${domain}`;
  }
  return contact.slice(0, 3) + '***' + contact.slice(-2);
}

const getApiKey = getClientEMRKey;

export async function getCredits(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const apiKey = await getApiKey(req.clientId);
    if (!apiKey) {
      ok(res, { email: 0, sms: 0, total: 0, connected: false, available: false });
      return;
    }
    try {
      const credits = await fetchCredits(apiKey);
      ok(res, { ...credits, connected: true, available: true });
    } catch {
      ok(res, { email: 0, sms: 0, total: 0, connected: true, available: false });
    }
  } catch (e) {
    next(e);
  }
}

export async function listTemplates(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const apiKey = await getApiKey(req.clientId);
    if (!apiKey) {
      ok(res, { templates: [] });
      return;
    }
    const templates = await fetchCampaignTemplates(apiKey);
    ok(res, { templates });
  } catch (e) {
    ok(res, { templates: [] });
  }
}
