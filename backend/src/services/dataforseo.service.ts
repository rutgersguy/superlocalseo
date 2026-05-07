import { config } from '../config';
import { logger } from '../utils/logger';

const BASE_URL = 'https://api.dataforseo.com/v3';

// DataForSEO Google Ads location codes for US states
// Full list: https://api.dataforseo.com/v3/keywords_data/google_ads/locations
const US_STATE_LOCATION_CODES: Record<string, number> = {
  AL: 21132, AK: 21133, AZ: 21136, AR: 21138, CA: 21137,
  CO: 21139, CT: 21140, DE: 21141, FL: 21142, GA: 21143,
  HI: 21144, ID: 21145, IL: 21146, IN: 21147, IA: 21148,
  KS: 21149, KY: 21150, LA: 21151, ME: 21152, MD: 21153,
  MA: 21154, MI: 21155, MN: 21156, MS: 21157, MO: 21158,
  MT: 21159, NE: 21160, NV: 21161, NH: 21163, NJ: 21164,
  NM: 21165, NY: 21162, NC: 21166, ND: 21169, OH: 21168,
  OK: 21167, OR: 21170, PA: 21171, RI: 21172, SC: 21173,
  SD: 21174, TN: 21175, TX: 21176, UT: 21177, VT: 21178,
  VA: 21179, WA: 21180, WV: 21181, WI: 21182, WY: 21183,
  DC: 21184,
};

export function locationCodeForState(stateAbbr: string | null | undefined): number {
  if (!stateAbbr) return 2840; // fallback: national US
  const code = US_STATE_LOCATION_CODES[stateAbbr.trim().toUpperCase()];
  return code ?? 2840;
}

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
    // Send all keywords in a single task for efficiency
    const tasks = [{ keywords, location_code: locationCode, language_code: 'en' }];

    const data = (await dfsPost('/keywords_data/google_ads/search_volume/live', tasks)) as {
      tasks?: Array<{
        result?: Array<{
          keyword: string;
          search_volume: number | null;
        }>;
      }>;
    };

    const resultMap = new Map<string, number | null>();
    for (const task of data.tasks ?? []) {
      for (const row of task.result ?? []) {
        resultMap.set(row.keyword.toLowerCase(), row.search_volume ?? null);
      }
    }

    return keywords.map((kw) => ({
      keyword: kw,
      monthlySearchVolume: resultMap.get(kw.toLowerCase()) ?? null,
    }));
  } catch (e) {
    logger.error('DataForSEO search volume fetch failed', { error: (e as Error).message, keywords });
    return keywords.map((keyword) => ({ keyword, monthlySearchVolume: null }));
  }
}
