import { db } from '../db/connection';
import { logger } from '../utils/logger';

const FB_BASE = 'https://graph.facebook.com/v19.0';

interface FBReviewer {
  name?: string;
  id?: string;
}

interface FBOpenGraphStory {
  id?: string;
}

interface FBRating {
  rating: number;
  review_text?: string;
  created_time: string;
  reviewer?: FBReviewer;
  open_graph_story?: FBOpenGraphStory;
}

interface FBRatingsResponse {
  data?: FBRating[];
  paging?: {
    cursors?: {
      before?: string;
      after?: string;
    };
    next?: string;
  };
}

async function fetchPageRatings(pageId: string, pageAccessToken: string): Promise<FBRating[]> {
  const ratings: FBRating[] = [];
  let url: string | undefined =
    `${FB_BASE}/${pageId}/ratings?fields=rating,review_text,created_time,reviewer,open_graph_story&access_token=${encodeURIComponent(pageAccessToken)}&limit=100`;

  while (url) {
    const res = await fetch(url);

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Facebook ratings fetch failed (${res.status}): ${text}`);
    }

    const data = (await res.json()) as FBRatingsResponse;
    if (data.data) ratings.push(...data.data);
    url = data.paging?.next;
  }

  return ratings;
}

export async function syncFacebookReviews(
  clientId: string,
  pageId: string,
  pageAccessToken: string,
): Promise<void> {
  const ratings = await fetchPageRatings(pageId, pageAccessToken);
  const now = new Date();

  for (const rating of ratings) {
    const externalReviewId =
      rating.open_graph_story?.id ?? `${pageId}_${rating.created_time}`;

    await db('reviews')
      .insert({
        client_id: clientId,
        location_id: null,
        // Direct Facebook OAuth sync, not EMR — so its id is Facebook's, not an EMR review id,
        // and it cannot be replied to through EMR's reply endpoint.
        source: 'facebook',
        platform: 'facebook',
        external_review_id: externalReviewId,
        author_name: rating.reviewer?.name ?? 'Anonymous',
        rating: rating.rating,
        body: rating.review_text ?? null,
        sentiment: null,
        status: 'new',
        review_date: new Date(rating.created_time),
        ingested_at: now,
        platform_url: null,
        replied: false,
        reply_date: null,
        emr_reply_text: null,
        hidden: false,
        avatar_url: null,
        verified: null,
      })
      .onConflict(['client_id', 'platform', 'external_review_id'])
      .merge({
        author_name: rating.reviewer?.name ?? 'Anonymous',
        rating: rating.rating,
        body: rating.review_text ?? null,
        ingested_at: now,
      });
  }

  logger.info('Facebook reviews synced', { clientId, totalReviews: ratings.length });
}
