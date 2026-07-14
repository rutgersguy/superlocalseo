import { randomInt } from 'crypto';
import { config } from '../config';
import { logger } from '../utils/logger';

// Derived at module load so config is already populated
const BASE_URL = () => `${config.embedmyreviews.baseUrl}/api/v1`;
const AGENCY_BASE_URL = () => `${config.embedmyreviews.baseUrl}/api/agency/v1`;

export interface EMRReview {
  id: string;
  platform: string;
  author: string;
  rating: number;
  body: string;
  date: string;
  url: string | null;
  replied: boolean;
  replyDate: string | null;
  replyText: string | null;
  hidden: boolean;
  avatarUrl: string | null;
  verified: boolean | null;
}

export interface EMRCampaign {
  id: string;
  name: string;
  invited: number;
  opened: number;
  clicked: number;
  reviewed: number;
  privateFeedback: number;
  unsubscribed: number;
}

async function emrFetch(path: string, apiKey: string, options: RequestInit = {}, base?: string): Promise<Response> {
  const url = `${base ?? BASE_URL()}${path}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    ...(options.headers as Record<string, string> | undefined),
  };

  let attempts = 0;
  const maxAttempts = 3;

  while (attempts < maxAttempts) {
    const res = await fetch(url, { ...options, headers });

    if (res.status === 429) {
      const retryAfter = parseInt(res.headers.get('retry-after') ?? '10', 10);
      logger.warn('EmbedMyReviews rate limited, backing off', { retryAfter });
      await new Promise((r) => setTimeout(r, retryAfter * 1000));
      attempts++;
      continue;
    }

    return res;
  }

  throw new Error('EmbedMyReviews: max retry attempts exceeded after rate limiting');
}

export async function fetchReviews(
  apiKey: string,
  opts: { locationId?: string; page?: number; rating?: number; sourceNames?: string[] } = {},
): Promise<{ reviews: EMRReview[]; hasMore: boolean }> {
  const params = new URLSearchParams();
  if (opts.locationId) params.set('location_id', opts.locationId);
  if (opts.page && opts.page > 1) params.set('page', String(opts.page));
  if (opts.rating) params.set('rating', String(opts.rating));
  if (opts.sourceNames?.length) opts.sourceNames.forEach((s) => params.append('source_names[]', s));

  const query = params.toString() ? `?${params.toString()}` : '';
  const res = await emrFetch(`/reviews${query}`, apiKey);

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`EmbedMyReviews fetchReviews failed: ${res.status} ${body}`);
  }

  const data = await res.json() as {
    data?: Array<{
      id: string;
      source: string;
      author: string;
      rating: number;
      message: string;
      date: string;
      source_url?: string;
      reply?: string | null;
      reply_date?: string | null;
      replied?: boolean;
      hidden?: boolean;
      avatar?: string | null;
      verified?: boolean;
    }>;
    meta?: { current_page: number; last_page: number };
  };

  const reviews = (data?.data ?? []).map((r) => ({
    id: r.id,
    platform: r.source,
    author: r.author,
    rating: r.rating,
    body: r.message,
    date: r.date,
    url: r.source_url ?? null,
    replied: r.replied ?? !!r.reply,
    replyDate: r.reply_date ?? null,
    replyText: r.reply ?? null,
    hidden: r.hidden ?? false,
    avatarUrl: r.avatar ?? null,
    verified: r.verified ?? null,
  }));

  const meta = data?.meta;
  const hasMore = meta ? meta.current_page < meta.last_page : false;

  return { reviews, hasMore };
}

/**
 * Fetches every review visible to `apiKey`, optionally scoped to a single EMR location.
 *
 * ALWAYS pass a locationId for per-client syncs. Without it the agency operator key returns
 * the whole organization's reviews, which is how every client ended up sharing one review
 * set (see migration 20260714000000).
 */
export async function fetchAllReviews(apiKey: string, locationId?: string): Promise<EMRReview[]> {
  const all: EMRReview[] = [];
  let page = 1;
  let hasMore = true;

  while (hasMore) {
    const result = await fetchReviews(apiKey, { page, locationId });
    all.push(...result.reviews);
    hasMore = result.hasMore;
    page++;
  }

  return all;
}

/** Thrown when EMR refuses the reply for a reason the user needs to hear, not a 500. */
export class EMRReplyError extends Error {
  readonly httpStatus: number;
  readonly code: string;
  constructor(message: string, httpStatus: number, code: string) {
    super(message);
    this.name = 'EMRReplyError';
    this.httpStatus = httpStatus;
    this.code = code;
  }
}

/**
 * Publishes a reply to a review. It goes LIVE on the platform immediately — EMR's docs:
 * "The reply goes live on the platform IMMEDIATELY — there is no approval step."
 *
 * This is the ONLY way we can post a reply to Google. BrightLocal told us plainly they don't
 * support review response via API (2026-07-14), and our own GBP write scope is useless while
 * the quota request is pending.
 *
 * Known refusals, surfaced as EMRReplyError rather than a generic 500:
 *  - 402: the organisation's plan lacks the auto-respond feature.
 *  - 403/422: the review's source can't be replied to (e.g. a Place-ID / "public access"
 *    Google source rather than a real API connection).
 *  - 409: Facebook only allows one reply; Google replies UPDATE the existing one.
 */
export async function replyToReview(
  apiKey: string,
  emrReviewId: string,
  message: string,
): Promise<void> {
  const res = await emrFetch(`/reviews/${encodeURIComponent(emrReviewId)}/reply`, apiKey, {
    method: 'POST',
    body: JSON.stringify({ message }),
  });

  if (res.ok) return;

  const body = await res.text();
  logger.error('EMR replyToReview failed', { emrReviewId, status: res.status, body });

  if (res.status === 402) {
    throw new EMRReplyError(
      'Replying to reviews is not enabled on this account yet. Contact support.',
      402,
      'REPLY_NOT_ON_PLAN',
    );
  }
  if (res.status === 403 || res.status === 422) {
    throw new EMRReplyError(
      'This review cannot be replied to — its source is not connected through Google.',
      res.status,
      'REPLY_SOURCE_UNSUPPORTED',
    );
  }
  if (res.status === 409) {
    throw new EMRReplyError('This review already has a reply and cannot be replied to again.', 409, 'ALREADY_REPLIED');
  }
  if (res.status === 404) {
    // We hold a review row whose EMR id no longer resolves — deleted upstream, or our copy is
    // stale. Don't 500; tell the user it's out of sync (the next poll will reconcile).
    throw new EMRReplyError(
      'This review is no longer available on the review platform — it may have been removed.',
      404,
      'REVIEW_NOT_FOUND',
    );
  }

  throw new Error(`EMR replyToReview failed: ${res.status} ${body}`);
}

export interface EMRConnectLink {
  token: string;
  provider: 'google' | 'facebook';
  locationId: number;
  connectUrl: string;
  status: 'active' | 'used' | 'expired' | 'revoked';
  completedOauthAt: string | null;
  expiresAt: string | null;
}

function mapConnectLink(d: Record<string, unknown>): EMRConnectLink {
  return {
    token: String(d.token),
    provider: d.provider as 'google' | 'facebook',
    locationId: Number(d.location_id),
    connectUrl: String(d.connect_url),
    status: (d.status as EMRConnectLink['status']) ?? 'active',
    completedOauthAt: (d.completed_oauth_at as string | null) ?? null,
    expiresAt: (d.expires_at as string | null) ?? null,
  };
}

/**
 * Mints a single-use, location-scoped OAuth link for a client to connect Google (or
 * Facebook) to THEIR EMR location.
 *
 * This is what replaces both dead ends we had:
 *   - our own Google OAuth, which is inert while our GBP API quota approval is pending;
 *   - the "log into the review portal" credentials card, which attaches the profile to the
 *     client's SUB-ACCOUNT org — data our agency key cannot read (see migration
 *     20260714000000).
 *
 * The returned connect_url is on our white-label domain (app.superlocalseo.com/connect/...),
 * so the client never sees EMR branding, and EMR's own Google API approval does the work —
 * ours is not required.
 *
 * EMR allows ONE active link per (location, provider); re-issuing auto-revokes the previous.
 */
export async function createConnectLink(
  apiKey: string,
  provider: 'google' | 'facebook',
  locationId: number,
  ttlDays = 14,
): Promise<EMRConnectLink> {
  const res = await emrFetch('/connect-links', apiKey, {
    method: 'POST',
    body: JSON.stringify({ provider, location_id: locationId, ttl_days: ttlDays }),
  }, AGENCY_BASE_URL());

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`EMR createConnectLink failed: ${res.status} ${body}`);
  }

  const json = await res.json() as { data?: Record<string, unknown> };
  if (!json.data) throw new Error('EMR createConnectLink: no data in response');
  return mapConnectLink(json.data);
}

/** Lists connect links for a location, so we can report whether the client finished OAuth. */
export async function listConnectLinks(
  apiKey: string,
  locationId: number,
  provider?: 'google' | 'facebook',
): Promise<EMRConnectLink[]> {
  const params = new URLSearchParams({ location_id: String(locationId) });
  if (provider) params.set('provider', provider);

  const res = await emrFetch(`/connect-links?${params.toString()}`, apiKey, {}, AGENCY_BASE_URL());
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`EMR listConnectLinks failed: ${res.status} ${body}`);
  }

  const json = await res.json() as { data?: Array<Record<string, unknown>> };
  return (json.data ?? []).map(mapConnectLink);
}

export interface EMROrganization {
  id: number;
  name: string;
  defaultLocationId: number | null;
}

/** Lists organizations on the agency account. Ours is the single tenant org. */
export async function listOrganizations(apiKey: string): Promise<EMROrganization[]> {
  const res = await emrFetch('/organizations', apiKey);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`EMR listOrganizations failed: ${res.status} ${body}`);
  }
  const json = await res.json() as {
    data?: Array<{ id: number; name: string; default_location_id?: number | null }>;
  };
  return (json.data ?? []).map((o) => ({
    id: o.id,
    name: o.name,
    defaultLocationId: o.default_location_id ?? null,
  }));
}

/**
 * Creates an EMR location. One per client — this is the unit `connect-links` attaches a
 * Google profile to, and the unit `GET /reviews?location_id=` filters by, so it's what
 * makes per-client review isolation possible.
 */
export async function createLocation(
  apiKey: string,
  organizationId: number,
  name: string,
): Promise<{ id: number; organizationId: number }> {
  const res = await emrFetch('/locations', apiKey, {
    method: 'POST',
    body: JSON.stringify({ organization_id: organizationId, name }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`EMR createLocation failed: ${res.status} ${body}`);
  }
  const json = await res.json() as { data?: { id?: number; organization_id?: number } };
  const id = json?.data?.id;
  if (!id) throw new Error('EMR createLocation: no location id in response');
  return { id, organizationId: json?.data?.organization_id ?? organizationId };
}

export async function fetchCampaigns(apiKey: string): Promise<EMRCampaign[]> {
  const res = await emrFetch('/request-reviews/campaigns', apiKey);

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`EmbedMyReviews fetchCampaigns failed: ${res.status} ${body}`);
  }

  const data = await res.json() as {
    data?: Array<{
      id: string;
      name: string;
      statistics?: {
        invited?: number;
        opened?: number;
        clicked?: number;
        reviewed?: number;
        private_feedback?: number;
        unsubscribed?: number;
      };
    }>;
  };

  return (data?.data ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    invited: c.statistics?.invited ?? 0,
    opened: c.statistics?.opened ?? 0,
    clicked: c.statistics?.clicked ?? 0,
    reviewed: c.statistics?.reviewed ?? 0,
    privateFeedback: c.statistics?.private_feedback ?? 0,
    unsubscribed: c.statistics?.unsubscribed ?? 0,
  }));
}

export async function sendInvite(
  apiKey: string,
  campaignId: string,
  contact: { firstName: string; lastName?: string; email?: string; phone?: string },
): Promise<void> {
  if (!contact.email && !contact.phone) {
    throw new Error('Invite requires at least email or phone');
  }

  const res = await emrFetch(`/request-reviews/campaigns/${encodeURIComponent(campaignId)}/invite`, apiKey, {
    method: 'POST',
    body: JSON.stringify({
      first_name: contact.firstName,
      last_name: contact.lastName ?? '',
      ...(contact.email ? { email: contact.email } : {}),
      ...(contact.phone ? { phone: contact.phone } : {}),
    }),
  });

  if (!res.ok && res.status !== 202) {
    const body = await res.text();
    throw new Error(`EmbedMyReviews sendInvite failed: ${res.status} ${body}`);
  }
}

export async function validateApiKey(apiKey: string): Promise<boolean> {
  try {
    const res = await emrFetch('/account', apiKey);
    return res.status === 200;
  } catch (e) {
    logger.warn('EmbedMyReviews validateApiKey error', { error: (e as Error).message });
    return false;
  }
}

// Webhook registration is done via the agency dashboard UI:
// app.superlocalseo.com → Settings → API & Webhooks
// Enter endpoint URL and select events — no API registration endpoint exists.
export function registerWebhook(_apiKey: string, webhookUrl: string): Promise<boolean> {
  logger.info('EMR webhook registration is UI-only', { webhookUrl });
  return Promise.resolve(false);
}

// ─── Agency customer lifecycle (EMR-1) ────────────────────────────────────────

export interface EMRCustomer {
  id: string;
  email: string;
  businessName: string;
  plan: string;
  status: string;
  apiKey: string;
}

/**
 * Generates the password for a client's EMR sub-account.
 *
 * Uses crypto.randomBytes, NOT Math.random() — Math.random is a non-cryptographic PRNG whose
 * output is predictable from observed values, and this is a real credential handed to a
 * customer. Kept to a guaranteed-satisfiable shape (lower + upper + digit + symbol) so EMR's
 * password policy can't reject it.
 */
function generateEmrPassword(): string {
  const LOWER = 'abcdefghijkmnopqrstuvwxyz';   // no 'l'
  const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';    // no 'I', 'O'
  const DIGIT = '23456789';                    // no '0', '1'
  const SYMBOL = '!@#$%^&*';
  const ALL = LOWER + UPPER + DIGIT + SYMBOL;

  const pick = (set: string): string => set[randomInt(set.length)];

  // One of each class up front, then fill to 20 chars, then shuffle so the classes aren't
  // in a predictable position.
  const chars = [pick(LOWER), pick(UPPER), pick(DIGIT), pick(SYMBOL)];
  while (chars.length < 20) chars.push(pick(ALL));

  // Fisher-Yates with a CSPRNG source.
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }

  return chars.join('');
}

export async function createCustomer(
  businessName: string,
  email: string,
): Promise<{ customerId: string; password: string }> {
  const operatorKey = config.embedmyreviews.agencyKey || config.embedmyreviews.apiKey;
  if (!operatorKey) throw new Error('EMBEDMYREVIEWS_AGENCY_KEY not configured');

  const password = generateEmrPassword();

  // Try with plain business name first; fall back to "Name (email)" if company name is taken.
  for (const company of [businessName, `${businessName} (${email})`]) {
    const res = await emrFetch('/customers', operatorKey, {
      method: 'POST',
      body: JSON.stringify({ name: email, company, email, password }),
    }, AGENCY_BASE_URL());

    if (res.status === 422) {
      const body = await res.text();
      if (body.includes('company')) continue; // name collision — retry with disambiguated name
      throw new Error(`EMR createCustomer failed: 422 ${body}`);
    }

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`EMR createCustomer failed: ${res.status} ${body}`);
    }

    // Response shape: { data: { id: number, ... } }
    const json = await res.json() as { data?: { id?: number | string } };
    const customerId = String(json?.data?.id ?? '');
    if (!customerId) throw new Error('EMR createCustomer: no customer id in response');
    return { customerId, password };
  }

  throw new Error('EMR createCustomer: company name conflict could not be resolved');
}

export async function deleteCustomer(customerId: string): Promise<void> {
  const operatorKey = config.embedmyreviews.agencyKey || config.embedmyreviews.apiKey;
  if (!operatorKey) return;

  const res = await emrFetch(`/customers/${encodeURIComponent(customerId)}`, operatorKey, {
    method: 'DELETE',
  }, AGENCY_BASE_URL());

  if (!res.ok && res.status !== 404) {
    const body = await res.text();
    throw new Error(`EMR deleteCustomer failed: ${res.status} ${body}`);
  }
}

/**
 * Pauses a customer's EMR subscription.
 *
 * NOTE: this previously called `POST /customers/{id}/suspend`, which DOES NOT EXIST — the
 * documented endpoint is `PUT /customers/{customer}/pause`. Because the failure was swallowed
 * as a warning, every cancellation silently no-op'd and EMR sub-accounts piled up. Failures
 * now log at error level so they show up instead of rotting.
 *
 * Per EMR docs, pause/resume is "only available when the plan is not linked to Stripe" — a
 * Stripe-linked plan returns an error, which we surface rather than hide.
 */
export async function suspendCustomer(customerId: string): Promise<void> {
  const operatorKey = config.embedmyreviews.agencyKey || config.embedmyreviews.apiKey;
  if (!operatorKey) return;

  const res = await emrFetch(`/customers/${encodeURIComponent(customerId)}/pause`, operatorKey, {
    method: 'PUT',
  }, AGENCY_BASE_URL());

  if (!res.ok && res.status !== 404) {
    const body = await res.text();
    logger.error('EMR suspendCustomer (pause) failed', { customerId, status: res.status, body });
    throw new Error(`EMR pause failed: ${res.status} ${body}`);
  }
}

/** Resumes a paused EMR customer subscription (counterpart to suspendCustomer). */
export async function resumeCustomer(customerId: string): Promise<void> {
  const operatorKey = config.embedmyreviews.agencyKey || config.embedmyreviews.apiKey;
  if (!operatorKey) return;

  const res = await emrFetch(`/customers/${encodeURIComponent(customerId)}/resume`, operatorKey, {
    method: 'PUT',
  }, AGENCY_BASE_URL());

  if (!res.ok && res.status !== 404) {
    const body = await res.text();
    logger.error('EMR resumeCustomer failed', { customerId, status: res.status, body });
    throw new Error(`EMR resume failed: ${res.status} ${body}`);
  }
}

export interface EMRAgencyCustomer {
  id: string;
  name: string | null;
  company: string | null;
  email: string | null;
}

/**
 * Lists every customer in the agency account (paginated). Used to reconcile EMR against our
 * own `clients.emr_customer_id` and find orphans — sub-accounts whose client no longer exists.
 */
export async function listAllCustomers(): Promise<EMRAgencyCustomer[]> {
  const operatorKey = config.embedmyreviews.agencyKey || config.embedmyreviews.apiKey;
  if (!operatorKey) throw new Error('EMBEDMYREVIEWS_AGENCY_KEY not configured');

  const out: EMRAgencyCustomer[] = [];
  let page = 1;

  // Hard page cap: a malformed/looping response must not spin forever.
  for (; page <= 100; page++) {
    const res = await emrFetch(`/customers?page=${page}`, operatorKey, {}, AGENCY_BASE_URL());
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`EMR listAllCustomers failed: ${res.status} ${body}`);
    }

    const json = await res.json() as {
      data?: Array<{ id?: number | string; name?: string; company?: string; email?: string }>;
      meta?: { current_page?: number; last_page?: number };
      links?: { next?: string | null };
    };

    const rows = json.data ?? [];
    for (const r of rows) {
      if (r.id == null) continue;
      out.push({
        id: String(r.id),
        name: r.name ?? null,
        company: r.company ?? null,
        email: r.email ?? null,
      });
    }

    const lastPage = json.meta?.last_page;
    const hasNext = lastPage != null ? page < lastPage : !!json.links?.next && rows.length > 0;
    if (!hasNext) break;
  }

  return out;
}

export interface EMRFeedback {
  id: string;
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
  rating?: number;
  message?: string;
  campaignId?: string;
  receivedAt: string;
}

export async function fetchFeedback(
  apiKey: string,
  opts: { page?: number; campaignId?: string } = {},
): Promise<{ feedback: EMRFeedback[]; total: number; hasMore: boolean }> {
  const params = new URLSearchParams();
  if (opts.page && opts.page > 1) params.set('page', String(opts.page));
  if (opts.campaignId) params.set('campaign_id', opts.campaignId);
  const query = params.toString() ? `?${params.toString()}` : '';
  const res = await emrFetch(`/request-reviews/feedback${query}`, apiKey);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`EMR fetchFeedback failed: ${res.status} ${body}`);
  }
  const data = await res.json() as {
    data?: Array<{
      id: string;
      first_name?: string;
      last_name?: string;
      email?: string;
      phone?: string;
      rating?: number;
      message?: string;
      campaign_id?: string;
      created_at?: string;
    }>;
    meta?: { current_page: number; last_page: number; total?: number };
  };
  const items = data?.data ?? [];
  const meta = data?.meta;
  return {
    feedback: items.map((f) => ({
      id: f.id,
      contactName: [f.first_name, f.last_name].filter(Boolean).join(' ') || undefined,
      contactEmail: f.email,
      contactPhone: f.phone,
      rating: f.rating,
      message: f.message,
      campaignId: f.campaign_id,
      receivedAt: f.created_at ?? new Date().toISOString(),
    })),
    total: meta?.total ?? items.length,
    hasMore: meta ? meta.current_page < meta.last_page : false,
  };
}

export interface EMRUnsubscribe {
  contact: string;
  type: 'email' | 'sms';
  unsubscribedAt: string;
}

export async function fetchCredits(
  apiKey: string,
): Promise<{ email: number; sms: number; total: number }> {
  const res = await emrFetch('/account/credits', apiKey);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`EMR fetchCredits failed: ${res.status} ${body}`);
  }
  const data = await res.json() as {
    email?: number; email_credits?: number;
    sms?: number; sms_credits?: number;
    total?: number;
  };
  const email = data.email ?? data.email_credits ?? 0;
  const sms = data.sms ?? data.sms_credits ?? 0;
  return { email, sms, total: email + sms };
}

export interface EMRTemplate {
  id: string;
  name: string;
  description: string;
  type: string;
  defaultMessage?: string;
}

export async function fetchCampaignTemplates(apiKey: string): Promise<EMRTemplate[]> {
  const res = await emrFetch('/request-reviews/campaign-templates', apiKey);
  if (!res.ok) {
    return [];
  }
  const data = await res.json() as {
    data?: Array<{ id: string; name: string; description?: string; type?: string; message?: string }>;
  };
  return (data?.data ?? []).map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description ?? '',
    type: t.type ?? 'general',
    defaultMessage: t.message,
  }));
}

export async function createCampaign(
  apiKey: string,
  name: string,
  templateId?: string,
): Promise<EMRCampaign> {
  const body: Record<string, unknown> = { name };
  if (templateId) body.template_id = templateId;

  const res = await emrFetch('/request-reviews/campaigns', apiKey, {
    method: 'POST',
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`EMR createCampaign failed: ${res.status} ${text}`);
  }

  const data = await res.json() as {
    data?: {
      id: string;
      name: string;
      statistics?: {
        invited?: number;
        opened?: number;
        clicked?: number;
        reviewed?: number;
        private_feedback?: number;
        unsubscribed?: number;
      };
    };
  };

  const c = data?.data;
  if (!c?.id) throw new Error('EMR createCampaign: unexpected response shape');

  return {
    id: c.id,
    name: c.name,
    invited: c.statistics?.invited ?? 0,
    opened: c.statistics?.opened ?? 0,
    clicked: c.statistics?.clicked ?? 0,
    reviewed: c.statistics?.reviewed ?? 0,
    privateFeedback: c.statistics?.private_feedback ?? 0,
    unsubscribed: c.statistics?.unsubscribed ?? 0,
  };
}

export async function fetchUnsubscribes(
  apiKey: string,
  opts: { page?: number } = {},
): Promise<{ unsubscribes: EMRUnsubscribe[]; total: number; hasMore: boolean }> {
  const params = new URLSearchParams();
  if (opts.page && opts.page > 1) params.set('page', String(opts.page));
  const query = params.toString() ? `?${params.toString()}` : '';
  const res = await emrFetch(`/request-reviews/unsubscribes${query}`, apiKey);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`EMR fetchUnsubscribes failed: ${res.status} ${body}`);
  }
  const data = await res.json() as {
    data?: Array<{ contact: string; type?: string; created_at?: string; unsubscribed_at?: string }>;
    meta?: { current_page: number; last_page: number; total?: number };
  };
  const items = data?.data ?? [];
  const meta = data?.meta;
  return {
    unsubscribes: items.map((u) => ({
      contact: u.contact,
      type: u.type === 'sms' ? 'sms' : 'email',
      unsubscribedAt: u.unsubscribed_at ?? u.created_at ?? new Date().toISOString(),
    })),
    total: meta?.total ?? items.length,
    hasMore: meta ? meta.current_page < meta.last_page : false,
  };
}
