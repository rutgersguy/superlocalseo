import { resolveProviderRoute, withProviderRoute } from '../services/provider_routing';
import { mappedCampaignClient, setupView } from '../services/campaign_verification';
import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { db } from '../db/connection';
import { ok, err } from '../utils/response';
import { sendInvite } from '../services/embedmyreviews.service';
import { getClientEMRKey } from '../services/emr_provisioning';
import { logger } from '../utils/logger';

async function campaignRoute(clientId: string, campaignId: string, locationId?: unknown) {
  const selected = z.string().uuid().optional().parse(locationId);
  const requests = await db('campaign_setup_requests').where({ client_id: clientId, status: 'verified' }).whereRaw("verification->>'campaignId' = ?", [campaignId]);
  const candidates = requests.filter(r => !selected || r.location_id === selected);
  if (candidates.length !== 1) throw Object.assign(new Error('This campaign needs a verified setup for one business location before invitations can be sent.'), { status: 409 });
  const request = candidates[0];
  const locations = await db('locations').where({ client_id: clientId });
  const location = locations.find(l => l.id === request.location_id);
  const client = await db('clients').where({ id: clientId }).first();
  const mappings = await db('provider_location_mappings').where({ client_id: clientId });
  const campaigns = await db('emr_campaigns').where({ client_id: clientId, emr_campaign_id: campaignId });
  if (setupView(request, location, mappedCampaignClient(client, location, mappings), campaigns, locations.length).status !== 'verified') throw Object.assign(new Error('Campaign setup changed. Ask support to verify it again.'), { status: 409 });
  const route = await resolveProviderRoute(clientId, request.location_id);
  if (!route) throw Object.assign(new Error('Provider mapping is required.'), { status: 409 });
  return route;
}

export async function list(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const selected = z.string().uuid().optional().parse(req.query.locationId);
    const route = selected ? await resolveProviderRoute(req.clientId, selected) : null;
    const campaigns = await db('emr_campaigns')
      .where({ client_id: req.clientId })
      .modify(q => { if (selected) { if (!route) q.whereRaw('false'); else q.where({ emr_organization_id: route.organizationId }); } })
      .orderBy('name', 'asc');

    ok(res, {
      scope: selected ? 'location-organization' : 'customer-organizations',
      campaigns: campaigns.map((c: any) => ({
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

/** The vendor REST API lists campaigns and sends invites; it cannot create campaigns.
 * Keep legacy callers explicit and fail closed instead of using an unscoped agency POST.
 */
export async function create(_req: Request, res: Response, _next: NextFunction): Promise<void> {
  err(res, 'Campaign setup is currently assisted. Contact hello@superlocalseo.com with your business name and location.', 501, 'CAMPAIGN_SETUP_REQUIRED');
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
      err(res, 'Review connection is not configured', 400, 'NOT_CONNECTED');
      return;
    }

    const campaign = await db('emr_campaigns')
      .where({ client_id: req.clientId, emr_campaign_id: campaignId })
      .first();
    if (!campaign) {
      err(res, 'Campaign not found', 404, 'NOT_FOUND');
      return;
    }

    const route = await campaignRoute(req.clientId, campaignId, req.body.locationId);
    await withProviderRoute(route, async () => { await campaignRoute(req.clientId, campaignId, route.localLocationId ?? undefined); await sendInvite(apiKey, campaignId, parsed.data); });

    ok(res, { accepted: 1, sent: 1, deliveryConfirmed: false });
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
      err(res, 'Review connection is not configured', 400, 'NOT_CONNECTED');
      return;
    }

    const campaign = await db('emr_campaigns')
      .where({ client_id: req.clientId, emr_campaign_id: campaignId })
      .first();
    if (!campaign) {
      err(res, 'Campaign not found', 404, 'NOT_FOUND');
      return;
    }

    const route = await campaignRoute(req.clientId, campaignId, req.body.locationId);
    const contacts = parsed.data.contacts;
    let sent = 0;
    let skipped = 0;
    const failures: Array<{ index: number; error: string }> = [];

    // EMR enforces opt-outs and its configured deduplication window. It has no REST
    // unsubscribe-list endpoint; acceptance does not prove delivery to this contact.
    for (let i = 0; i < contacts.length; i++) {
      try {
        await withProviderRoute(route, async () => { await campaignRoute(req.clientId, campaignId, route.localLocationId ?? undefined); await sendInvite(apiKey, campaignId, contacts[i]); });
        sent++;
      } catch (e) {
        failures.push({ index: i, error: (e as Error).message });
        logger.warn('Bulk invite failed for contact', { index: i, error: (e as Error).message });
      }
    }

    ok(res, { accepted: sent, sent, deliveryConfirmed: false, failed: failures.length - skipped, skipped, failures });
  } catch (e) {
    next(e);
  }
}

export async function listUnsubscribes(_req: Request, res: Response): Promise<void> {
  ok(res, { unsubscribes: [], total: null, hasMore: false, available: false,
    message: 'The provider enforces opt-outs when processing invitations. Its REST API does not expose an unsubscribe list.' });
}

const getApiKey = getClientEMRKey;

/**
 * EMR exposes NO endpoint for reading a customer's remaining credits — verified against their
 * API reference (2026-07-13). The only credit endpoint is agency-level `POST
 * /customers/{customer}/add-credits`, which *adds* credits and returns the new balance.
 *
 * fetchCredits() has therefore been hitting `/api/v1/account/credits` → 404 on every call
 * since it was written. The 404 was swallowed here, so the UI just quietly hid the credit
 * badge — while CreditBadge polls this route every 60s per open tab, firing a doomed request
 * to EMR each time (and burning the emrFetch retry/backoff path).
 *
 * Short-circuit instead of calling out. See docs/INTEGRATIONS.md "Open vendor questions" —
 * we've asked EMR whether a balance endpoint exists outside the public docs; if it does, wire
 * fetchCredits() to it and restore the call.
 */
export async function getCredits(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const apiKey = await getApiKey(req.clientId);
    ok(res, { email: null, sms: null, total: null, connected: !!apiKey, available: false });
  } catch (e) {
    next(e);
  }
}

export async function listTemplates(_req: Request, res: Response): Promise<void> {
  ok(res, { templates: [], available: false });
}
