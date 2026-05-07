import { config } from '../config';
import { logger } from '../utils/logger';

const BASE_URL = 'https://api.dataforseo.com/v3';

function authHeader(): string {
  const { login, password } = config.dataforseo;
  return 'Basic ' + Buffer.from(`${login}:${password}`).toString('base64');
}

async function dfsPost(path: string, body: unknown): Promise<unknown> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: {
      Authorization: authHeader(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`DataForSEO ${path} failed (${res.status}): ${text}`);
  }

  return res.json();
}

interface SearchVolumeResult {
  keyword: string;
  monthlySearchVolume: number | null;
}

export async function getSearchVolumes(keywords: string[], locationCode = 2840): Promise<SearchVolumeResult[]> {
  if (!config.dataforseo.login || !config.dataforseo.password) {
    logger.warn('DataForSEO credentials not configured — skipping search volume fetch');
    return keywords.map((keyword) => ({ keyword, monthlySearchVolume: null }));
  }

  try {
    const tasks = keywords.map((keyword) => ({
      keywords: [keyword],
      location_code: locationCode, // 2840 = United States
      language_code: 'en',
    }));

    const data = (await dfsPost('/keywords_data/google_ads/search_volume/live', tasks)) as {
      tasks?: Array<{
        result?: Array<{
          keyword: string;
          search_volume: number | null;
          monthly_searches?: Array<{ year: number; month: number; search_volume: number }>;
        }>;
      }>;
    };

    const results: SearchVolumeResult[] = [];

    for (const task of data.tasks ?? []) {
      for (const row of task.result ?? []) {
        results.push({
          keyword: row.keyword,
          monthlySearchVolume: row.search_volume ?? null,
        });
      }
    }

    // Return nulls for any keywords not found in response
    return keywords.map((kw) => {
      const found = results.find((r) => r.keyword.toLowerCase() === kw.toLowerCase());
      return found ?? { keyword: kw, monthlySearchVolume: null };
    });
  } catch (e) {
    logger.error('DataForSEO search volume fetch failed', { error: (e as Error).message, keywords });
    return keywords.map((keyword) => ({ keyword, monthlySearchVolume: null }));
  }
}
