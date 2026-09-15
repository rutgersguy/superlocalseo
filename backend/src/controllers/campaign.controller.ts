import { providerRoutes } from '../services/provider_routing';
import { dispatchInvitations, invitationSchema } from '../services/campaign_invitations';
import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { db } from '../db/connection';
import { ok, err } from '../utils/response';
import { getClientEMRKey } from '../services/emr_provisioning';

export async function list(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const selected = z.string().uuid().optional().parse(req.query.locationId);
    // No provider account is an onboarding state, not a failed campaign fetch.
    // Check local ownership before allowing that empty-state response.
    if (selected && !await db('locations').where({ id: selected, client_id: req.clientId }).first()) {
      err(res, 'Location not found', 404, 'NOT_FOUND'); return;
    }
    const client = await db('clients').where({ id: req.clientId }).first();
    const mapping = await db('provider_location_mappings').where({ client_id: req.clientId }).first();
    if (!mapping && !client?.emr_organization_id && !client?.emr_location_id) {
      ok(res, { scope: selected ? 'location-organization' : 'customer-organizations',
        setupState: 'connection_required', campaigns: [] });
      return;
    }
    // Incomplete IDs and invalid/stale/conflicting mappings must remain visible
    // failures; never return cached campaigns outside a verified provider route.
    const routes = await providerRoutes(req.clientId, selected);
    if (!routes.length) {
      err(res, 'Your review account setup is incomplete. Contact support to finish connecting this business.', 409, 'PROVIDER_SETUP_INCOMPLETE'); return;
    }
    const campaigns = await db('emr_campaigns')
      .where({ client_id: req.clientId })
      .where(q => {
        q.whereIn('emr_organization_id', routes.map(route => route.organizationId));
        // Older single-organization caches predate the organization column.
        if (routes.length === 1 && routes[0].mode === 'legacy') q.orWhereNull('emr_organization_id');
      })
      .orderBy('name', 'asc');

    ok(res, {
      scope: selected ? 'location-organization' : 'customer-organizations',
      setupState: campaigns.length ? 'ready' : 'campaign_setup_required',
      campaigns: campaigns.map((c: any) => ({
        id: c.id,
        emrCampaignId: c.emr_campaign_id,
        name: c.name,
        invited: c.statistics_checked ? c.invited : null,
        opened: c.statistics_checked ? c.opened : null,
        clicked: c.statistics_checked ? c.clicked : null,
        reviewed: c.statistics_checked ? c.reviewed : null,
        privateFeedback: c.statistics_checked ? c.private_feedback : null,
        unsubscribed: c.statistics_checked ? c.unsubscribed : null,
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

export async function invite(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { requestId, locationId, ...contact } = z.object({ ...invitationSchema.shape, requestId: z.string().uuid().optional(), locationId: z.string().uuid().optional() }).strict().parse(req.body);
    ok(res, await dispatchInvitations(req.clientId, req.userId, req.params.campaignId, [contact], requestId, locationId));
  } catch (e) { next(e); }
}
export async function bulkInvite(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const input = z.object({ contacts: z.array(invitationSchema).min(1).max(50), requestId: z.string().uuid().optional(), locationId: z.string().uuid().optional() }).strict().parse(req.body);
    ok(res, await dispatchInvitations(req.clientId, req.userId, req.params.campaignId, input.contacts, input.requestId, input.locationId));
  } catch (e) { next(e); }
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
