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

export async function fetchAllReviews(apiKey: string): Promise<EMRReview[]> {
  const all: EMRReview[] = [];
  let page = 1;
  let hasMore = true;

  while (hasMore) {
    const result = await fetchReviews(apiKey, { page });
    all.push(...result.reviews);
    hasMore = result.hasMore;
    page++;
  }

  return all;
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

export async function createCustomer(
  businessName: string,
  email: string,
): Promise<{ customerId: string; password: string }> {
  const operatorKey = config.embedmyreviews.agencyKey || config.embedmyreviews.apiKey;
  if (!operatorKey) throw new Error('EMBEDMYREVIEWS_AGENCY_KEY not configured');

  const password = Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10).toUpperCase() + '!1';

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

export async function suspendCustomer(customerId: string): Promise<void> {
  const operatorKey = config.embedmyreviews.agencyKey || config.embedmyreviews.apiKey;
  if (!operatorKey) return;

  const res = await emrFetch(`/customers/${encodeURIComponent(customerId)}/suspend`, operatorKey, {
    method: 'POST',
  }, AGENCY_BASE_URL());

  if (!res.ok && res.status !== 404) {
    const body = await res.text();
    logger.warn('EMR suspendCustomer failed (non-fatal)', { customerId, status: res.status, body });
  }
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
