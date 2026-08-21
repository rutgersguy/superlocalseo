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
  // Added after the first four-engine run. Claude formats far more variably
  // than the others and surfaced a fresh crop of bolded non-names:
  // "BBB Accredited with an A+ rating", "4.9 stars with 1,880+ Google reviews",
  // "100% Recommended", "My recommendation".
  'better', 'bureau', 'google', 'recommended', 'recommendation', 'recommendations',
  'choice', 'choices', 'option', 'options', 'pick', 'picks', 'tips', 'tip',
  'immediate', 'wait', 'tech', 'summary', 'verdict', 'takeaway',
  // Ordinary function words, so a phrase built only from these plus a badge
  // cannot survive on the strength of an unlisted connective.
  'with', 'from', 'you', 'your', 'my', 'our', 'their', 'while', 'when', 'what',
  'who', 'how', 'is', 'are', 'was', 'were', 'be', 'has', 'have', 'that', 'this',
  'these', 'those', 'it', 'its', 'they', 'we', 'us', 'all', 'any', 'more', 'most',
  // Bare comparison criteria an assistant uses as section headings. A candidate
  // made only of these is a heading, not a company.
  'affordability', 'reputation', 'pricing', 'availability', 'experience',
  'licensing', 'licence', 'license', 'warranties', 'quotes', 'quote', 'value',
  'cost', 'costs', 'price', 'prices', 'quality', 'reliability', 'speed',
  'good', 'bad', 'great', 'ideal', 'important', 'location', 'locations',
  'suited', 'range', 'hours', 'contact', 'details', 'specialties', 'specialty',
]);

/** Lowercase, fold `&` to `and`, drop punctuation, collapse whitespace. */
export function normalizeForMatch(s: string): string {
  return s
    .toLowerCase()
    .replace(/&/g, ' and ')
    // Apostrophes are DELETED, not spaced: "Campbell's" and "Campbells" are the
    // same business and appeared as two competitors until they folded together.
    .replace(/['’‘`]/g, '')
    .replace(/[“”]/g, '')
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
    const name = cleanCandidate(c.raw);
    if (!looksLikeBusinessName(name, ctx)) continue;
    const key = normalizeForMatch(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    found.push({ name, offset: c.offset });
  }

  return collapseVariants(found);
}

/**
 * Fold the short form of a business into its fuller one.
 *
 * Assistants refer to the same company at several lengths inside one answer —
 * "Torch", then "Torch Plumbing, Heating & Cooling"; "JayCo", then "JayCo HVACR
 * LLC". Left alone each is counted as a separate competitor, which inflates the
 * rival list a Pro customer reads and pushes their own position down.
 *
 * A candidate is absorbed when its normalised form is a WORD-BOUNDED prefix of
 * another's. Prefix rather than containment, so "TemperaturePro Bixby" and
 * "TemperaturePro Tulsa" — plausibly two real franchise locations — both
 * survive while the bare "TemperaturePro" folds into the earlier of them.
 * The longer name is kept, at the earliest offset either form appeared.
 */
function collapseVariants(
  names: Array<{ name: string; offset: number }>,
): Array<{ name: string; offset: number }> {
  const kept: Array<{ name: string; offset: number; key: string }> = [];

  for (const n of names) {
    const key = normalizeForMatch(n.name);
    const existing = kept.find(
      (k) => k.key === key || k.key.startsWith(key + ' ') || key.startsWith(k.key + ' '),
    );

    if (!existing) {
      kept.push({ ...n, key });
      continue;
    }

    // Keep the longer, more specific name and the earliest position it was seen.
    existing.offset = Math.min(existing.offset, n.offset);
    if (key.length > existing.key.length) {
      existing.name = n.name;
      existing.key = key;
    }
  }

  return kept
    .sort((a, b) => a.offset - b.offset)
    .map(({ name, offset }) => ({ name, offset }));
}

/**
 * Tidy a raw candidate before judging it.
 *
 * Strips leftover markdown (a heading like `### **Top picks:**` captures with its
 * asterisks intact) and drops a trailing parenthetical that is really a phone
 * number — Claude writes "Service Wizards (918-400-4444)", which would otherwise
 * be counted as a second, separate competitor alongside "Service Wizards" and
 * push the customer's position down by one.
 */
function cleanCandidate(raw: string): string {
  return raw
    // Remove markdown emphasis wherever it sits, not just at the ends. The
    // heading pattern captures a line like "### 1. **Air Dynamics of Tulsa**
    // (Highly Rated)" INCLUDING the closing asterisks, and the parenthetical is
    // stripped after them — which left "Air Dynamics of Tulsa**" as the name
    // shown to the customer. An asterisk never belongs in a business name.
    .replace(/[*#]/g, '')
    .trim()
    // A list marker written INSIDE the bold — "**1. Aire Serv of South Tulsa**".
    // Left in place it defeats variant collapsing entirely, because "1. Aire
    // Serv" is not a prefix of "Aire Serv of South Tulsa".
    .replace(/^\d+\s*[.)]\s*/, '')
    // "JayCo HVACR LLC / Jayco Heat & Air" — one company written two ways.
    .replace(/\s+\/\s+.*$/, '')
    // Trailing qualifier in brackets or after a dash. One answer produced SIX
    // entries for one company — "Aire Serv", "Aire Serv (South Tulsa/Bixby)",
    // "Aire Serv of South Tulsa (Bixby Location)", "Aire Serv of South Tulsa —
    // Bixby" and two more — each counted as a separate competitor.
    .replace(/\s*\([^)]*\)\s*$/, '')
    // Em/en dash ONLY, and only when spaced. A plain hyphen belongs to the name
    // itself — this rule turned "Okla-Home Heating & Cooling" into "Okla".
    .replace(/\s+[—–]\s+[^—–]{1,30}$/, '')
    .replace(/[:\-–—,\s]+$/, '')
    .trim();
}

/** Phone numbers, street addresses and rating claims are never business names. */
function isStructurallyNotAName(name: string): boolean {
  if (name.includes(':')) return true;                                  // "Call/Text: (918) 479"
  if (/\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}/.test(name)) return true;   // (918) 400-4444
  if (/^\d+\s+\w/.test(name)) return true;                             // 505 N Armstrong St
  if (/\d(\.\d)?\s*(star|stars|rating)/i.test(name)) return true;       // 4.9 stars
  if (/\b[A-F][+-]?\s*rating\b/i.test(name)) return true;               // A+ rating
  if (/\d+\s*%/.test(name)) return true;                                // 100% Recommended
  if (/\d[\d,]{2,}\+?\s*(reviews?|customers?)/i.test(name)) return true; // 1,880+ reviews
  return false;
}

/**
 * Words allowed to stay lowercase inside a proper-noun phrase.
 * "Aire Serv of South Tulsa", "Dale & Lee's", "Heating and Air".
 */
/**
 * Assistants structure answers with Title Case advice headings — "Get Multiple
 * Estimates", "Verify Licensing", "Ask About Warranties". They pass the
 * proper-noun test because they ARE title case, so they need their own rule.
 * Imperatives and gerunds are a bounded, stable pattern, unlike arbitrary
 * sentence phrasing, so a leading-verb list is appropriate here.
 */
const ADVICE_VERBS = new Set([
  'get', 'ask', 'verify', 'verifying', 'check', 'checking', 'compare', 'comparing',
  'find', 'finding', 'read', 'reading', 'look', 'looking', 'choose', 'choosing',
  'avoid', 'avoiding', 'consider', 'considering', 'contact', 'request', 'requesting',
  'schedule', 'scheduling', 'confirm', 'confirming', 'ensure', 'make', 'know',
  'understand', 'watch', 'beware', 'search', 'searching', 'tips', 'tip', 'how',
  'what', 'when', 'where', 'why', 'immediate', 'before', 'after', 'during',
  'call', 'about', 'known', 'note', 'bottom', 'overall', 'final', 'other',
]);

/** Abbreviation to full name, for recognising a place written either way. */
const US_STATE_NAMES: Record<string, string> = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California',
  CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', FL: 'Florida', GA: 'Georgia',
  HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa',
  KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland',
  MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi',
  MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire',
  NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York', NC: 'North Carolina',
  ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania',
  RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee',
  TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington',
  WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming', DC: 'District of Columbia',
};

const TITLE_CASE_STOPWORDS = new Set([
  'of', 'and', 'the', 'for', 'in', 'at', 'to', 'on', 'a', 'an', 'or', 'by', 'de', 'la',
]);

/**
 * Does this read as a proper-noun phrase — i.e. a name?
 *
 * This is the primary filter, and it replaced a growing blocklist of individual
 * words. That approach lost: every run of a non-deterministic model produced
 * fresh phrasings the list had never seen ("BBB-accredited / formal reputation",
 * "My practical recommendation", "Searching for recommendations"), so the list
 * only ever caught last week's noise.
 *
 * The structural signal is stable instead: businesses are Title Case
 * ("Air Comfort Solutions", "LEE Heat & Air"), and section headings and rating
 * claims are sentence case with lowercase content words.
 *
 * KNOWN LIMIT: a deliberately lowercase brand ("ecobee") is rejected here. That
 * costs it a place in the competitor list only — the mention decision searches
 * the full answer text and is unaffected — and stylised lowercase names are
 * vanishingly rare in the trades we serve.
 */
function readsAsProperNoun(name: string): boolean {
  const words = name
    .split(/[\s/]+/)
    .map((w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''))
    .filter((w) => w.length > 0 && /\p{L}/u.test(w));

  if (words.length === 0) return false;

  return words.every((w) => {
    if (TITLE_CASE_STOPWORDS.has(w.toLowerCase())) return true;
    return /^\p{Lu}/u.test(w);
  });
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

  if (isStructurallyNotAName(name)) return false;

  const firstWord = normalizeForMatch(name).split(' ')[0];
  if (ADVICE_VERBS.has(firstWord)) return false;

  // Primary filter — see readsAsProperNoun. Everything below is a narrower
  // backstop for phrases that ARE title case but still are not businesses
  // ("A+ Rating", "Top Choices").
  if (!readsAsProperNoun(name)) return false;

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
  // Assistants write the state both ways — "Bixby, OK" and "Bixby, Oklahoma" —
  // so the abbreviation alone missed half of them.
  const stateFull = normalizeForMatch(US_STATE_NAMES[(ctx.state ?? '').trim().toUpperCase()] ?? '');
  const places = new Set(
    [city, state, stateFull, `${city} ${state}`.trim(), `${city} ${stateFull}`.trim()].filter(Boolean),
  );
  if (places.has(norm)) return false;

  // Must carry at least one token that is neither generic trade vocabulary nor
  // a credential — otherwise it is a badge, not a business.
  const identifying = norm
    .split(' ')
    .filter((t) => t.length > 1 && !GENERIC_TOKENS.has(t) && !BADGE_TOKENS.has(t));
  if (identifying.length === 0) return false;

  return true;
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


/**
 * Count how often each business was named across many answers, folding the
 * variants of one company together.
 *
 * `collapseVariants` works within a single answer. This is the same idea across
 * a whole scan, and it is needed for the same reason: assistants name a company
 * at different lengths in different answers — "Aire Serv" in one, "Aire Serv of
 * South Tulsa" in another, "TemperaturePro" and "TemperaturePro Tulsa" — and a
 * naive tally presents them to the customer as separate competitors.
 *
 * The fullest form seen wins the display name, and its count is the total.
 */
export function mergeBusinessCounts(
  names: string[],
  selfNames: Array<string | null | undefined> = [],
): Array<{ name: string; timesNamed: number; isYou: boolean }> {
  // The customer's own business is named in these answers too — usually more
  // often than anyone else, since it is the one we are asking about. Left
  // unmarked it sits at the top of a list headed "who the assistants named"
  // and reads as though they are their own competitor. Marked, the same list
  // becomes the ranking it was meant to be.
  //
  // Takes a LIST of names, because the account name and the location name are
  // routinely different and it is the LOCATION name the scan actually asks
  // about. The first real report had a client registered as "AirServe of
  // Tulsa" whose location is "Aire Serv of South Tulsa" — neither string is a
  // prefix of the other, so matching on the account name alone marked nothing.
  const selfKeys = selfNames
    .map((n) => (n ? normalizeForMatch(n) : ''))
    .filter((k) => k.length > 0);

  const isSelf = (key: string) =>
    selfKeys.some((sk) => key === sk || key.startsWith(sk + ' ') || sk.startsWith(key + ' '));

  const merged: Array<{ name: string; key: string; n: number }> = [];

  for (const raw of names) {
    const key = normalizeForMatch(raw);
    if (!key) continue;

    const hit = merged.find(
      (m) => m.key === key || m.key.startsWith(key + ' ') || key.startsWith(m.key + ' '),
    );

    if (!hit) {
      merged.push({ name: raw, key, n: 1 });
      continue;
    }

    hit.n += 1;
    if (key.length > hit.key.length) {
      hit.name = raw;
      hit.key = key;
    }
  }

  return merged
    .sort((a, b) => b.n - a.n)
    .map((m) => ({ name: m.name, timesNamed: m.n, isYou: isSelf(m.key) }));
}
