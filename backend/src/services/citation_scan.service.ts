/**
 * Citation auditing via DataForSEO SERP (issue #174).
 *
 * Replaces the BrightLocal Data API, which is not available on our account —
 * 12-month contract, $500/mo minimum, declined (#149).
 *
 * THE TWO-STEP RULE
 * -----------------
 * Finding a listing and judging it need OPPOSITE matching, and using the wrong
 * one breaks the feature in opposite directions:
 *
 *   1. IDENTITY — fuzzy. "Aire Serv" must match "Aire Serv of South Tulsa".
 *      Without this we accept the wrong business: a real Houzz query returned
 *      "Tropic Aire Patio & Wicker Gallery" for an HVAC company.
 *
 *   2. VERDICT — strict. NAP consistency is an exact-match entity signal, so
 *      "505 N Armstrong St Suite Ab" and "505 N Armstrong. Ste AB." ARE a real
 *      inconsistency and must be reported. Normalising that away would hide the
 *      exact defect the feature exists to find.
 *
 * So: fuzzy to decide "is this us?", strict to decide "is it right?". Never reuse
 * normalizeStr()/normalizePhone() from the rankings code for step 2 — they exist
 * for step-1-style matching and would silently pass real inconsistencies.
 */
import { DirectoryDef } from '../config/directories.config';
import { logger } from '../utils/logger';
import { serpSearch, fetchPageText, getGoogleListing } from './dataforseo.service';

export type VerificationStatus = 'listed' | 'not_found' | 'unverified';

export interface LocationNap {
  name: string;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  phone: string | null;
}

export interface CitationScanResult {
  directory: string;
  status: VerificationStatus;
  unverifiedReason?: string;
  listingUrl?: string | null;
  /** What the directory shows — null when we could not read that field. */
  foundName?: string | null;
  foundAddress?: string | null;
  foundPhone?: string | null;
  /** Strict comparisons. null = we could not read that field, so cannot judge it. */
  nameMatch?: boolean | null;
  addressMatch?: boolean | null;
  phoneMatch?: boolean | null;
}

// ── step 1: identity (fuzzy) ───────────────────────────────────────────────

/** Loose form used ONLY to decide whether a listing is the same business. */
function loose(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Last 7 digits — enough to identify, tolerant of formatting and country code. */
function phoneKey(s: string): string {
  return s.replace(/\D/g, '').slice(-7);
}

/**
 * Is this search result plausibly OUR business?
 *
 * Requires a real signal, not just the directory domain: a name containment in
 * either direction, or a phone match. `MIN_NAME_LEN` stops a short name matching
 * an unrelated business by substring — "Air" must not match "Airtron Heating".
 */
const MIN_NAME_LEN = 6;

export function isSameBusiness(loc: LocationNap, text: string, url: string): boolean {
  const hay = loose(`${text} ${url}`);
  const digits = text.replace(/\D/g, '');

  // A phone match is decisive on its own — it identifies one business.
  if (loc.phone && phoneKey(loc.phone).length === 7 && digits.includes(phoneKey(loc.phone))) {
    return true;
  }

  const nameHit =
    (loose(loc.name).length >= MIN_NAME_LEN && hay.includes(loose(loc.name)))
    || (() => {
      const firstWords = loose(loc.name.split(/\s+/).slice(0, 2).join(''));
      return firstWords.length >= MIN_NAME_LEN && hay.includes(firstWords);
    })();

  if (!nameHit) return false;

  // A NAME MATCH ALONE IS NOT ENOUGH — it is the single biggest source of false
  // positives. Validation caught BBB returning a different "Joe's Pizza" in
  // Baldwinsville, 250 miles from the Carmine St one, and it would have been
  // reported as the customer's listing with a wrong address. Business names
  // repeat constantly across towns, so require geographic corroboration.
  if (loc.city && hay.includes(loose(loc.city))) return true;
  if (loc.zip && text.includes(loc.zip)) return true;
  if (loc.state && loc.city && hay.includes(loose(`${loc.city}${loc.state}`))) return true;

  return false;
}

// ── step 2: verdict (strict) ───────────────────────────────────────────────

/**
 * Strict comparison. Case and surrounding whitespace are not meaningful to a
 * search engine, but everything else is — punctuation, abbreviation and word
 * order all distinguish entities. "Ste" vs "Suite" is a genuine mismatch.
 */
function strictEqual(a: string | null | undefined, b: string | null | undefined): boolean | null {
  if (!a || !b) return null;
  return a.trim().replace(/\s+/g, ' ').toLowerCase() === b.trim().replace(/\s+/g, ' ').toLowerCase();
}

/** Phones compare on digits — formatting genuinely does not vary the entity. */
function phoneEqual(a: string | null | undefined, b: string | null | undefined): boolean | null {
  if (!a || !b) return null;
  const da = a.replace(/\D/g, ''), db = b.replace(/\D/g, '');
  if (!da || !db) return null;
  return da.slice(-10) === db.slice(-10);
}

// ── extraction ─────────────────────────────────────────────────────────────

/** Full street address as we hold it, for comparison against what a listing shows. */
export function expectedAddress(loc: LocationNap): string | null {
  if (!loc.address) return null;
  const tail = [[loc.city, loc.state].filter(Boolean).join(', '), loc.zip].filter(Boolean).join(' ');
  return tail ? `${loc.address}, ${tail}` : loc.address;
}

const PHONE_RE = /\(?\d{3}\)?[\s.\-]?\d{3}[\s.\-]?\d{4}/;

/**
 * URLs must be removed before any NAP extraction.
 *
 * Directory slugs contain long digit runs — a real BBB URL ending
 * "...-1025-38019557" matched the phone pattern and would have been reported as
 * the listing's phone number, producing a confident, wrong mismatch.
 */
function stripUrls(text: string): string {
  return text.replace(/https?:\/\/\S+/g, ' ').replace(/\b[\w-]+\.(com|org|net|co)\/\S*/g, ' ');
}

/**
 * Pull a street address out of free text.
 *
 * Anchored on the house number and terminated at the ZIP, which is the most
 * reliable shape in both snippets and page text. Deliberately conservative:
 * returning null (leading to `unverified`) is far better than returning a wrong
 * address and telling the customer their listing is broken when it is not.
 */
function extractAddress(text: string): string | null {
  // \b(?<!\d) prevents swallowing a preceding number. Validation caught this
  // producing "2026 505 N Armstrong..." (a year) and "1769 48 E Genesee St..."
  // (a review count) — both would have been reported as the listing's address.
  // Take the SHORTEST valid match, not the first.
  //
  // Snippets prefix addresses with numbers — a year, a review count — and a
  // greedy leftmost match swallows them: validation produced
  // "2026 - 3427 Reviews 7 Carmine St, New York, NY 10014". The real address is
  // always the tightest substring that still parses, so anchor an attempt at
  // every house-number candidate and keep the shortest that matches.
  const clean = stripUrls(text);
  const shape = /^\d{1,6}\s+[A-Za-z][A-Za-z0-9.,'\- ]{2,50}?,?\s*[A-Za-z .'-]{2,30},?\s*[A-Z]{2}\s*\d{5}/;

  let best: string | null = null;
  for (const m of clean.matchAll(/(?<![\d,.])\b\d{1,6}\s/g)) {
    const hit = clean.slice(m.index ?? 0).match(shape);
    if (!hit) continue;
    const candidate = hit[0].replace(/\s+/g, ' ').trim();
    if (!best || candidate.length < best.length) best = candidate;
  }
  return best;
}

function extractPhone(text: string): string | null {
  const m = stripUrls(text).match(PHONE_RE);
  return m ? m[0].trim() : null;
}

// ── the scan ───────────────────────────────────────────────────────────────

function unverified(directory: string, reason: string, url?: string | null): CitationScanResult {
  return { directory, status: 'unverified', unverifiedReason: reason, listingUrl: url ?? null };
}

async function scanGoogle(loc: LocationNap): Promise<CitationScanResult> {
  let listing;
  try {
    listing = await getGoogleListing(loc.name, loc.address, loc.city, loc.state);
  } catch (e) {
    return unverified('google', `gmb error: ${(e as Error).message.slice(0, 80)}`);
  }
  if (!listing) return { directory: 'google', status: 'not_found', listingUrl: null };

  // Same identity rule as everywhere else — a returned listing is not
  // automatically ours.
  const blob = `${listing.title ?? ''} ${listing.address ?? ''} ${listing.phone ?? ''}`;
  if (!isSameBusiness(loc, blob, listing.url ?? '')) {
    return unverified('google', 'returned listing did not match this business', listing.url);
  }

  return {
    directory: 'google',
    status: 'listed',
    listingUrl: listing.url,
    foundName: listing.title,
    foundAddress: listing.address,
    foundPhone: listing.phone,
    nameMatch: strictEqual(loc.name, listing.title),
    addressMatch: strictEqual(expectedAddress(loc), listing.address),
    phoneMatch: phoneEqual(loc.phone, listing.phone),
  };
}

export async function scanDirectory(loc: LocationNap, dir: DirectoryDef): Promise<CitationScanResult> {
  if (dir.unauditable) {
    return unverified(dir.key, 'directory does not publish indexable listings');
  }

  // Google is not searched — Maps listings are not indexed as web pages, so a
  // `site:google.com/maps` query finds nothing. Validation showed Google as a
  // miss while BrightLocal had it listed. My Business Info returns the fields
  // structured instead, with no snippet scraping at all.
  if (dir.key === 'google') return scanGoogle(loc);

  const where = [loc.city, loc.state].filter(Boolean).join(' ');
  const query = `site:${dir.domain} ${loc.name} ${where}`.trim();

  let results: Array<{ url: string; title: string; description: string }>;
  try {
    results = await serpSearch(query);
  } catch (e) {
    // An upstream failure is OUR problem, never reported as "not listed".
    return unverified(dir.key, `serp error: ${(e as Error).message.slice(0, 80)}`);
  }

  if (results.length === 0) {
    // Genuinely nothing indexed for this query. We cannot distinguish "no listing"
    // from "not indexed", so this is not_found only when the query itself worked.
    return { directory: dir.key, status: 'not_found', listingUrl: null };
  }

  const match = results.find((r) => isSameBusiness(loc, `${r.title} ${r.description}`, r.url));
  if (!match) {
    // Results came back but none are this business — commonly a category or
    // sitemap page. Claiming "not listed" here would be a guess.
    return unverified(dir.key, 'no result matched this business');
  }

  let text = `${match.title} ${match.description}`;
  let usedFetch = false;

  const snippetThin = !extractAddress(text) || !extractPhone(text);
  if (dir.strategy === 'fetch' || (dir.strategy === 'auto' && snippetThin)) {
    try {
      const page = await fetchPageText(match.url);
      if (page) { text = `${text} ${page}`; usedFetch = true; }
    } catch {
      // Fetching is best-effort — several directories block it (Yelp 403s).
      // We still have the snippet, so fall through rather than failing the scan.
    }
  }

  let foundAddress = extractAddress(text);
  const foundPhone = extractPhone(text);

  // The extractor takes the first address-shaped string in the text, which is not
  // necessarily THIS business's address. Validation caught Manta yielding
  // "1735 N Federal Hwy, Hollywood, FL" for a New York pizzeria — a confident,
  // completely wrong mismatch would have been reported to the customer.
  //
  // So an address is only trusted when it corroborates the location we expect.
  // Failing that we treat it as unreadable: "we could not check this" is always
  // safer than "your listing is wrong".
  if (foundAddress) {
    const inSamePlace =
      (loc.zip && foundAddress.includes(loc.zip))
      || (loc.city && loose(foundAddress).includes(loose(loc.city)));
    if (!inSamePlace) foundAddress = null;
  }

  if (!foundAddress && !foundPhone) {
    return unverified(
      dir.key,
      usedFetch ? 'listing found but no NAP could be read from page' : 'listing found but snippet had no NAP',
      match.url,
    );
  }

  return {
    directory: dir.key,
    status: 'listed',
    listingUrl: match.url,
    foundName: match.title || null,
    foundAddress,
    foundPhone,
    // Strict, per the two-step rule. null where the field could not be read —
    // "we could not check this field" is not the same as "it does not match".
    // Identity was already confirmed above against title+description; this is
    // the narrower question of whether the TITLE carries the name.
    nameMatch: match.title ? isSameBusiness(loc, `${match.title} ${match.description}`, match.url) : null,
    addressMatch: strictEqual(expectedAddress(loc), foundAddress),
    phoneMatch: phoneEqual(loc.phone, foundPhone),
  };
}

/**
 * Scans a location across directories, sequentially.
 *
 * Sequential on purpose: this runs weekly in a background job, so wall-clock is
 * irrelevant, and hammering a metered API in parallel buys nothing.
 */
export async function scanLocation(loc: LocationNap, dirs: DirectoryDef[]): Promise<CitationScanResult[]> {
  const out: CitationScanResult[] = [];
  for (const dir of dirs) {
    const res = await scanDirectory(loc, dir);
    out.push(res);
    if (res.status === 'unverified') {
      logger.debug('Citation scan unverified', { directory: dir.key, reason: res.unverifiedReason });
    }
  }
  return out;
}
