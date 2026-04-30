import { logger } from '../utils/logger';

const BASE_URL = 'https://api.embedmyreviews.com/v1';

export interface EMRReview {
  id: string;
  platform: string;
  author: string;
  rating: number;
  body: string;
  date: string; // ISO date string
  url: string | null;
}

async function emrFetch(path: string, apiKey: string, options: RequestInit = {}): Promise<Response> {
  const url = `${BASE_URL}${path}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
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

export async function fetchReviews(apiKey: string, locationName?: string): Promise<EMRReview[]> {
  const query = locationName ? `?location=${encodeURIComponent(locationName)}` : '';
  const res = await emrFetch(`/reviews${query}`, apiKey);

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`EmbedMyReviews fetchReviews failed: ${res.status} ${body}`);
  }

  const data = (await res.json()) as { reviews?: Array<{ id: string; platform: string; author_name: string; rating: number; body: string; date: string; url: string | null }> };
  const reviews = data?.reviews ?? [];

  return reviews.map((r) => ({
    id: r.id,
    platform: r.platform,
    author: r.author_name,
    rating: r.rating,
    body: r.body,
    date: r.date,
    url: r.url,
  }));
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

export async function registerWebhook(apiKey: string, webhookUrl: string): Promise<boolean> {
  try {
    const res = await emrFetch('/webhooks', apiKey, {
      method: 'POST',
      body: JSON.stringify({ url: webhookUrl, events: ['review.created', 'review.updated'] }),
    });
    return res.ok;
  } catch (e) {
    logger.warn('EmbedMyReviews registerWebhook error', { error: (e as Error).message });
    return false;
  }
}
