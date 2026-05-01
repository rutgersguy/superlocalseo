import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { db } from '../db/connection';
import { ok, err } from '../utils/response';
import { sendInvite, fetchUnsubscribes } from '../services/embedmyreviews.service';
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
      ok(res, { unsubscribes: [], total: 0 });
      return;
    }
    const page = Math.max(1, parseInt(String(req.query.page ?? '1'), 10));
    const result = await fetchUnsubscribes(apiKey, { page });

    ok(res, {
      unsubscribes: result.unsubscribes.map((u) => ({
        ...u,
        contact: maskContact(u.contact, u.type),
      })),
      total: result.total,
      hasMore: result.hasMore,
    });
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
