import { runLlmPrompt } from './dataforseo.service';
import { industryNoun } from '../config/ai_engines.config';
import { logger } from '../utils/logger';

/**
 * Deciding whether an assistant recommended a business.
 *
 * THE THREE STATES, AND WHY THE THIRD EXISTS
 * ------------------------------------------
 * Every check lands on `mentioned`, `absent`, or `unverified` — the same shape
 * the citation scanner settled on (#174), for the same reason. An upstream
 * failure, a refusal, or a name we cannot reliably detect are all "we do not
 * know", and telling a customer "ChatGPT does not recommend you" on the strength
 * of a rate-limited request is a fabricated negative. `unverified` is excluded
 * from scoring rather than counted against the business.
 *
 * `absent` is the strongest claim we make, so it carries the highest bar: the
 * assistant must have answered AND named at least one business. An answer that
 * names nobody ("I'd suggest checking Google reviews") proves nothing about this
 * business and is recorded as unverified.
 *
 * WHY MATCHING IS TWO-PASS
 * ------------------------
 * Exact containment alone misses "Williams Plumbing" when the business is
 * registered as "Williams Plumbing & Drain Service LLC". Loose token matching
 * alone produces the opposite failure: a business called "Tulsa Plumbing" would
 * match the phrase "for your Tulsa plumbing needs", inventing a recommendation
 * that was never made. So we match the full name first, then fall back to the
 * name's DISTINCTIVE tokens — what is left after removing the industry noun, the
 * city, the state and generic trade words.
 *
 * A name with no distinctive tokens at all ("Tulsa Plumbing", "AC Repair Co")
 * cannot be told apart from ordinary prose by any string method. Those return
 * `unverified` with a reason, and are the honest limit of this technique.
 */

export type MentionStatus = 'mentioned' | 'absent' | 'unverified';

export interface MentionAnalysis {
  status: MentionStatus;
  unverifiedReason: string | null;
  /** 1-based rank among the businesses named, first mention wins. Null unless mentioned. */
  position: number | null;
  /** Every business the answer named, in the order it named them. */
  businessesNamed: string[];
  /** Hostnames the answer cited, in order, deduped. */
  citations: string[];
}

/** Generic trade and corporate words that carry no identity on their own. */
const GENERIC_TOKENS = new Set([
  'the', 'and', 'of', 'a', 'an', 'for', 'at', 'in', 'to',
  'llc', 'inc', 'incorporated', 'co', 'corp', 'corporation', 'ltd', 'pllc', 'pc', 'plc', 'lp', 'llp',
  'company', 'companies', 'group', 'services', 'service', 'solutions', 'systems', 'associates',
  'brothers', 'bros', 'sons', 'family', 'home', 'homes', 'local', 'best', 'top', 'quality', 'pro', 'pros',
  'professional', 'expert', 'experts', 'master', 'masters', 'certified', 'licensed',
  'plumbing', 'plumber', 'plumbers', 'hvac', 'heating', 'cooling', 'air', 'conditioning', 'ac',
  'electric', 'electrical', 'electrician', 'electricians', 'roofing', 'roofer', 'roofers', 'roof',
  'landscaping', 'landscaper', 'lawn', 'cleaning', 'cleaners', 'maid', 'pest', 'control',
  'painting', 'painter', 'painters', 'flooring', 'floors', 'moving', 'movers', 'contracting',
  'contractor', 'contractors', 'construction', 'repair', 'repairs', 'restoration', 'remodeling',
  'dental', 'dentist', 'dentistry', 'orthodontics', 'law', 'legal', 'attorney', 'attorneys',
  'lawyer', 'lawyers', 'firm', 'salon', 'spa', 'barbershop', 'barber', 'nails', 'hair', 'beauty',
  'auto', 'automotive', 'car', 'tire', 'collision', 'body', 'shop', 'restaurant', 'cafe', 'coffee',
  'bakery', 'kitchen', 'grill', 'insurance', 'agency', 'realty', 'real', 'estate', 'properties',
  'property', 'management', 'accounting', 'cpa', 'tax', 'veterinary', 'vet', 'animal', 'clinic',
  'hospital', 'health', 'wellness', 'fitness', 'gym', 'studio', 'therapy', 'therapist',
  'photography', 'photo', 'tutoring', 'tutors', 'center', 'centre', 'care', 'supply', 'works',
]);

/**
 * Words that describe a credential or rating rather than an identity.
 *
 * Assistants bold these constantly — "**A+ rating**", "**BBB Accredited**",
 * "**24/7 emergency services**" — and a bold span is our main signal that
 * something is a business name. Left unfiltered they enter the competitor list
 * and, worse, push the customer's real position down: Aire Serv was reported
 * second in an answer that listed it first, because "Bixby, OK" and "A+ rating"
 * were counted as businesses ahead of it.
 *
 * A candidate is rejected only when it consists ENTIRELY of these plus generic
 * trade words, so "Five Star Plumbing" survives while "5-star rated" does not.
 */
const BADGE_TOKENS = new Set([
  'a', 'b', 'c', 'd', 'f', 'plus', 'bbb', 'accredited', 'accreditation',
  'rating', 'ratings', 'rated', 'star', 'stars', 'review', 'reviews',
  'licensed', 'insured', 'bonded', 'certified', 'certification', 'epa',
  'guarantee', 'guaranteed', 'warranty', 'emergency', 'available', 'open',
  'hours', 'hour', 'service', 'services', 'free', 'estimates', 'estimate',
  'financing', 'discount', 'discounts', 'why', 'call', 'them', 'address',
  'phone', 'website', 'overview', 'pros', 'cons', 'note', 'notes',
]);

/** Lowercase, fold `&` to `and`, drop punctuation, collapse whitespace. */
export function normalizeForMatch(s: string): string {
  return s
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[‘’“”]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The parts of a business name that actually identify it.
 * "Williams Plumbing & Drain" in Tulsa OK for a plumbing business → ["williams", "drain"]
 * "Tulsa Plumbing" in Tulsa OK for a plumbing business            → []
 */
export function distinctiveTokens(
  businessName: string,
  ctx: { industry: string | null; city: string | null; state: string | null },
): string[] {
  const banned = new Set(GENERIC_TOKENS);
  for (const t of normalizeForMatch(industryNoun(ctx.industry)).split(' ')) banned.add(t);
  for (const t of normalizeForMatch(ctx.city ?? '').split(' ')) if (t) banned.add(t);
  for (const t of normalizeForMatch(ctx.state ?? '').split(' ')) if (t) banned.add(t);

  return normalizeForMatch(businessName)
    .split(' ')
    .filter((t) => t.length > 1 && !banned.has(t));
}

/**
 * Candidate business names, in the order the answer introduces them.
 *
 * All three assistants mark names with markdown bold; Gemini additionally uses
 * numbered headings. Bold is not exclusively used for names, though — Perplexity
 * bolds the phrase "best-known plumbers in Tulsa" — so candidates that read as
 * prose rather than a name are dropped.
 *
 * This drives the competitor list and the position number. It deliberately does
 * NOT drive the mention decision, which searches the full text instead: a missed
 * candidate would otherwise become a false "absent".
 */
export function extractBusinessNames(
  text: string,
  ctx: { industry: string | null; city: string | null; state: string | null },
): Array<{ name: string; offset: number }> {
  const found: Array<{ name: string; offset: number }> = [];
  const seen = new Set<string>();

  const patterns = [
    /\*\*([^*\n]{2,70})\*\*/g,          // **Acts of Service Plumbing**
    /^#{1,6}\s*\d*\.?\s*(.{2,70})$/gm,  // ### 1. Williams Plumbing & Drain
  ];

  const candidates: Array<{ raw: string; offset: number }> = [];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) candidates.push({ raw: m[1], offset: m.index });
  }
  candidates.sort((a, b) => a.offset - b.offset);

  for (const c of candidates) {
    const name = c.raw.trim().replace(/[:\-–—,\s]+$/, '').trim();
    if (!looksLikeBusinessName(name, ctx)) continue;
    const key = normalizeForMatch(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    found.push({ name, offset: c.offset });
  }

  return found;
}

/** Rejects the bold spans that are labels, prose, places or credentials. */
function looksLikeBusinessName(
  name: string,
  ctx: { industry: string | null; city: string | null; state: string | null },
): boolean {
  if (name.length < 3 || name.length > 70) return false;
  const words = name.split(/\s+/);
  if (words.length > 8) return false;

  // "Overview:", "Pros:", "Why they stand out:" — label, not a name.
  if (/[:?]$/.test(name)) return false;

  // Leading superlatives mark a description: "best-known plumbers in Tulsa".
  if (/^(the\s+)?(best|top|most|why|how|what|overview|pros|cons|summary|note|tip|bottom|key|other)\b/i.test(name)) {
    return false;
  }

  const norm = normalizeForMatch(name);
  if (!norm) return false;

  // The location itself is bolded in most answers ("**Bixby, OK**"). Rejected
  // only on an EXACT match against the place, so a business genuinely named
  // after its town — "Bixby Heating & Air" — is still counted as a competitor.
  const city = normalizeForMatch(ctx.city ?? '');
  const state = normalizeForMatch(ctx.state ?? '');
  const places = new Set([city, state, `${city} ${state}`.trim()].filter(Boolean));
  if (places.has(norm)) return false;

  // Must carry at least one token that is neither generic trade vocabulary nor
  // a credential — otherwise it is a badge, not a business.
  const identifying = norm
    .split(' ')
    .filter((t) => t.length > 1 && !GENERIC_TOKENS.has(t) && !BADGE_TOKENS.has(t));
  if (identifying.length === 0) return false;

  // A real name carries at least one capitalised word that is not a stopword.
  return words.some((w) => /^[A-Z]/.test(w) && !GENERIC_TOKENS.has(w.toLowerCase()));
}

/** Hostnames cited inline in the answer text, in order, deduped. */
export function extractCitations(text: string): string[] {
  const re = /https?:\/\/([^\s)\]]+)/g;
  const urls: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) urls.push(m[1]);
  return hostnames(urls);
}

/** Bare hostnames from URLs, deduped, order preserved. */
export function hostnames(urls: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const u of urls) {
    const host = u
      .replace(/^https?:\/\//, '')
      .split('/')[0]
      .replace(/^www\./, '')
      .toLowerCase();
    if (!host || seen.has(host)) continue;
    seen.add(host);
    out.push(host);
  }
  return out;
}

/**
 * Decide whether `businessName` was recommended in `text`.
 */
export function analyzeMention(
  businessName: string,
  text: string,
  ctx: { industry: string | null; city: string | null; state: string | null },
): MentionAnalysis {
  const named = extractBusinessNames(text, ctx);
  const citations = extractCitations(text);
  const businessesNamed = named.map((n) => n.name);

  const haystack = normalizeForMatch(text);
  const needleFull = normalizeForMatch(stripLegalSuffix(businessName));
  const tokens = distinctiveTokens(businessName, ctx);

  let matchOffsetNorm = -1;

  // ORDER MATTERS. The generic-name guard runs BEFORE plain containment.
  //
  // Containment first looks obviously correct and is not: for a business called
  // "Tulsa Plumbing", the string "tulsa plumbing" occurs in the ordinary
  // sentence "A few Tulsa plumbing companies that appear to be well-regarded",
  // so containment reports a recommendation the assistant never made. A caught
  // regression, not a hypothetical — see the test of the same name.
  if (tokens.length === 0) {
    // The name carries no identity of its own, so prose cannot be told from a
    // reference to this business. One exception is sound: if the answer marked
    // that exact name as a business — bolded or headed, which is what
    // extractBusinessNames reads — the markup itself supplies the context the
    // words lack.
    const explicit = named.find((n) => normalizeForMatch(n.name) === needleFull);
    if (explicit) {
      const offset = haystack.indexOf(needleFull);
      return {
        status: 'mentioned',
        unverifiedReason: null,
        position: rankAmong(named, haystack, offset),
        businessesNamed,
        citations,
      };
    }
    return {
      status: 'unverified',
      unverifiedReason:
        `"${businessName}" is composed entirely of generic trade and location words, ` +
        `so it cannot be distinguished from ordinary prose in the answer`,
      position: null,
      businessesNamed,
      citations,
    };
  }

  if (needleFull && haystack.includes(needleFull)) {
    matchOffsetNorm = haystack.indexOf(needleFull);
  } else {
    // Every distinctive token must appear, and close enough together to be one
    // name rather than coincidental mentions scattered through the answer.
    const offsets = tokens.map((t) => firstWordOffset(haystack, t));
    if (offsets.every((o) => o >= 0)) {
      const lo = Math.min(...offsets);
      const hi = Math.max(...offsets);
      if (hi - lo <= 60) matchOffsetNorm = lo;
    }
  }

  if (matchOffsetNorm < 0) {
    // Absence is only assertable when the assistant actually recommended
    // somebody. An answer naming nobody tells us nothing about this business.
    if (businessesNamed.length === 0) {
      return {
        status: 'unverified',
        unverifiedReason: 'the assistant named no businesses, so non-mention proves nothing',
        position: null,
        businessesNamed,
        citations,
      };
    }
    return { status: 'absent', unverifiedReason: null, position: null, businessesNamed, citations };
  }

  return {
    status: 'mentioned',
    unverifiedReason: null,
    position: rankAmong(named, haystack, matchOffsetNorm),
    businessesNamed,
    citations,
  };
}

/**
 * 1-based rank of a match among the businesses the answer named.
 *
 * Counts rivals introduced earlier than our match. Offsets are measured on the
 * normalized string so both sides share one coordinate space — comparing a raw
 * offset against a normalized one drifts by however much punctuation was folded
 * away, which silently reorders the ranking.
 */
function rankAmong(
  named: Array<{ name: string; offset: number }>,
  haystack: string,
  matchOffsetNorm: number,
): number {
  const ahead = named.filter((n) => {
    const o = haystack.indexOf(normalizeForMatch(n.name));
    return o >= 0 && o < matchOffsetNorm;
  }).length;
  return ahead + 1;
}

function stripLegalSuffix(name: string): string {
  return name.replace(/[,\s]+(llc|l\.l\.c\.|inc\.?|incorporated|co\.?|corp\.?|ltd\.?|pllc|p\.c\.|pc)\s*$/i, '').trim();
}

/** Offset of `token` in `haystack` at a word boundary, or -1. */
function firstWordOffset(haystack: string, token: string): number {
  const re = new RegExp(`\\b${token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
  const m = re.exec(haystack);
  return m ? m.index : -1;
}

export interface AiVisibilityCheck extends MentionAnalysis {
  engine: string;
  modelName: string;
  promptKey: string;
  promptText: string;
  responseText: string | null;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

/**
 * Run one prompt against one assistant and analyse the answer.
 * Never throws — an upstream failure becomes an `unverified` check, so one dead
 * engine cannot abort a location's whole scan.
 */
export async function checkVisibility(params: {
  engine: string;
  modelName: string;
  promptKey: string;
  promptText: string;
  businessName: string;
  industry: string | null;
  city: string | null;
  state: string | null;
}): Promise<AiVisibilityCheck> {
  const base = {
    engine: params.engine,
    modelName: params.modelName,
    promptKey: params.promptKey,
    promptText: params.promptText,
  };

  try {
    const res = await runLlmPrompt({
      engine: params.engine,
      modelName: params.modelName,
      prompt: params.promptText,
    });

    const analysis = analyzeMention(params.businessName, res.text, {
      industry: params.industry,
      city: params.city,
      state: params.state,
    });

    // Structured annotations first — they are the only source Gemini and
    // Perplexity provide — then anything cited inline that they did not list.
    const citations = hostnames([...res.sourceUrls, ...analysis.citations]);

    return {
      ...base,
      ...analysis,
      citations,
      modelName: res.modelName,
      responseText: res.text,
      inputTokens: res.inputTokens,
      outputTokens: res.outputTokens,
      costUsd: res.costUsd,
    };
  } catch (e) {
    const message = (e as Error).message;
    logger.warn('AI visibility check failed', { engine: params.engine, promptKey: params.promptKey, error: message });
    return {
      ...base,
      status: 'unverified',
      unverifiedReason: `assistant unavailable: ${message}`,
      position: null,
      businessesNamed: [],
      citations: [],
      responseText: null,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
    };
  }
}
