export interface OnPageResult {
  score: number;
  details: string[];
}

// Regex helpers — no external HTML parser dependency needed.
function extractTitle(html: string): string | null {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? m[1].replace(/<[^>]+>/g, '').trim() : null;
}

function extractMetaDescription(html: string): string | null {
  const m =
    html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["'][^>]*>/i) ??
    html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["'][^>]*>/i);
  return m ? m[1].trim() : null;
}

function countH1s(html: string): number {
  return (html.match(/<h1[\s>]/gi) ?? []).length;
}

function hasLocalBusinessSchema(html: string): boolean {
  const scripts = html.match(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi) ?? [];
  for (const script of scripts) {
    const content = script.replace(/<script[^>]*>/, '').replace(/<\/script>/i, '');
    try {
      const parsed = JSON.parse(content) as Record<string, unknown>;
      const types: string[] = Array.isArray(parsed['@graph'])
        ? (parsed['@graph'] as Array<Record<string, unknown>>).map((n) => String(n['@type'] ?? ''))
        : [String(parsed['@type'] ?? '')];
      if (types.some((t) => /LocalBusiness|Service|Plumber|Electrician|Dentist|Lawyer|Restaurant|MedicalBusiness|HealthAndBeautyBusiness|AutoRepair|RealEstateAgent|HomeAndConstructionBusiness/i.test(t))) {
        return true;
      }
    } catch {
      // malformed JSON-LD — skip
    }
  }
  return false;
}

function hasCanonical(html: string): boolean {
  return /<link[^>]+rel=["']canonical["'][^>]*>/i.test(html) ||
    /<link[^>]+href=["'][^"']+["'][^>]+rel=["']canonical["'][^>]*>/i.test(html);
}

function hasViewport(html: string): boolean {
  return /<meta[^>]+name=["']viewport["'][^>]*>/i.test(html);
}

export async function checkOnPageSeo(websiteUrl: string): Promise<OnPageResult> {
  const details: string[] = [];
  let score = 0;

  // HTTPS check (10 pts) — before fetch
  if (websiteUrl.startsWith('https://')) {
    score += 10;
    details.push('Site served over HTTPS');
  } else {
    details.push('Not using HTTPS — migrate to HTTPS to protect visitors and improve rankings');
  }

  let html = '';
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    const res = await fetch(websiteUrl, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LocalSEOAuditBot/1.0)' },
      redirect: 'follow',
    });
    clearTimeout(timer);

    if (!res.ok) {
      details.push(`Website returned HTTP ${res.status} — check that the URL is accessible`);
      return { score, details };
    }

    html = await res.text();
  } catch {
    details.push('Could not fetch website — check that the URL is live and publicly accessible');
    return { score, details };
  }

  // Title tag (20 pts)
  const title = extractTitle(html);
  if (!title) {
    details.push('No <title> tag found — every page needs a unique, descriptive title');
  } else {
    score += 10;
    const len = title.length;
    if (len >= 30 && len <= 60) {
      score += 10;
      details.push(`Title tag: "${title.slice(0, 60)}" (${len} chars — optimal length)`);
    } else if (len < 30) {
      details.push(`Title tag: "${title}" (${len} chars — too short, aim for 30–60 chars)`);
    } else {
      details.push(`Title tag present but too long (${len} chars — trim to 60 or fewer)`);
    }
  }

  // Meta description (20 pts)
  const metaDesc = extractMetaDescription(html);
  if (!metaDesc) {
    details.push('No meta description found — add a 120–160 char description with your primary keyword and location');
  } else {
    score += 10;
    const len = metaDesc.length;
    if (len >= 120 && len <= 160) {
      score += 10;
      details.push(`Meta description present (${len} chars — optimal length)`);
    } else if (len < 120) {
      details.push(`Meta description present but short (${len} chars — expand to 120–160 chars)`);
    } else {
      details.push(`Meta description present but too long (${len} chars — trim to 160 chars to avoid truncation)`);
    }
  }

  // H1 tag (15 pts)
  const h1Count = countH1s(html);
  if (h1Count === 0) {
    details.push('No <h1> tag found — add one H1 that includes your primary service and city');
  } else if (h1Count === 1) {
    score += 15;
    details.push('1 H1 tag found — good');
  } else {
    score += 8;
    details.push(`${h1Count} H1 tags found — reduce to exactly 1 per page for clarity`);
  }

  // Schema markup (20 pts)
  const hasSchema = hasLocalBusinessSchema(html);
  if (hasSchema) {
    score += 20;
    details.push('LocalBusiness schema markup (JSON-LD) detected — great for rich results');
  } else {
    details.push('No LocalBusiness JSON-LD schema found — add structured data to help Google understand your business');
  }

  // Canonical URL (5 pts)
  if (hasCanonical(html)) {
    score += 5;
    details.push('Canonical URL tag present');
  } else {
    details.push('No canonical tag found — add to avoid duplicate content issues');
  }

  // Viewport (10 pts)
  if (hasViewport(html)) {
    score += 10;
    details.push('Mobile viewport meta tag present');
  } else {
    details.push('No viewport meta tag — site may not be mobile-friendly (critical for local search)');
  }

  return { score: Math.min(100, score), details };
}
