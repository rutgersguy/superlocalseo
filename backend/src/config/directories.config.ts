/**
 * The directory registry for citation auditing (issue #174).
 *
 * Each entry maps our internal directory key to the domain we search and the
 * strategy we use to read the listing. Strategy is per-directory because the
 * sites behave differently, which we measured rather than assumed:
 *
 *   yelp.com        page fetch returns 403 — blocked. But the SERP snippet
 *                   carries the full NAP, so snippet is the ONLY path.
 *   yellowpages.com page fetch returns 200 with the full page, and the snippet
 *                   omits the phone — so fetching adds real information.
 *   bbb.org         same as yellowpages.
 *
 * A single blanket strategy would therefore lose our best source (Yelp) or
 * under-read the ones that allow fetching. Hence `strategy` per directory.
 *
 *   'snippet'  read NAP from the SERP result only (site blocks fetching, or the
 *              snippet is reliably complete)
 *   'fetch'    discover the URL via SERP, then fetch the page for the NAP
 *   'auto'     try the snippet; fall back to fetching when the snippet is thin
 *
 * `unauditable` marks the two directories no search-based method can reach:
 * Apple Maps and Bing Places do not publish indexable listings. Verified —
 * `site:maps.apple.com <business>` returns one junk result and
 * `site:bing.com/maps <business>` returns nothing. These are never scanned and
 * never counted; the customer claims them via the self-serve portals instead
 * (#173).
 */

export type ScanStrategy = 'snippet' | 'fetch' | 'auto';

export type Vertical =
  | 'home' | 'health' | 'legal' | 'food'
  | 'beauty' | 'auto' | 'professional' | 'realestate';

export interface DirectoryDef {
  /** Internal key — matches citation_snapshots.directory and the UI's DIRECTORY_NAMES. */
  key: string;
  label: string;
  /** Domain used in the `site:` query. */
  domain: string;
  strategy: ScanStrategy;
  /**
   * True when no search-based audit can reach it. Never scanned, never scored;
   * surfaced to the customer as "claim this yourself" instead.
   */
  unauditable?: boolean;
  /**
   * Industry this directory serves. Absent means core — relevant to every
   * business. A vertical directory is only ever scanned for, and only ever
   * scored against, a matching business: Avvo legitimately does not list a
   * pizzeria, so counting that as a miss would measure nothing.
   */
  vertical?: Vertical;
  /**
   * Set when MEASUREMENT showed we cannot reliably find listings here.
   *
   * The bar is 25% found on a sample of at least 8 — core directories judged on
   * 34 businesses, vertical ones on 8 of their own industry. Anything
   * disqualified is RE-CHECKED whenever the scanner changes: fixing the phone
   * and empty-result defects moved ZocDoc from 13% to 38% and Thumbtack,
   * RateMDs and HappyCow from 13% to 25%, all of which were restored. A
   * directory dropped on a buggy measurement is still dropped on no evidence.
   *
   * The bar is deliberately about evidence, not accuracy: if we never once
   * found a listing across the sample, we have no grounds to tell a customer
   * "you are not listed" — we only know that we could not find it. Publishing
   * that as a verdict sends them to create a duplicate, and duplicate listings
   * actively damage local ranking.
   *
   * Not scanned, not billed, not shown. Each carries its measured rate.
   */
  unsupported?: string;
}

export const DIRECTORIES: Record<string, DirectoryDef> = {
  // ── Core (checked for every industry) ────────────────────────────────────
  google:         { key: 'google',         label: 'Google Business Profile', domain: 'google.com/maps',   strategy: 'snippet' },
  bing:           { key: 'bing',           label: 'Bing Places',             domain: 'bing.com/maps',     strategy: 'snippet', unauditable: true },
  apple:          { key: 'apple',          label: 'Apple Maps',              domain: 'maps.apple.com',    strategy: 'snippet', unauditable: true },
  yelp:           { key: 'yelp',           label: 'Yelp',                    domain: 'yelp.com',          strategy: 'snippet' },
  facebook:       { key: 'facebook',       label: 'Facebook',                domain: 'facebook.com',      strategy: 'snippet' },
  bbb:            { key: 'bbb',            label: 'Better Business Bureau',  domain: 'bbb.org',           strategy: 'auto' },
  yellowpages:    { key: 'yellowpages',    label: 'Yellow Pages',            domain: 'yellowpages.com',   strategy: 'auto' },
  foursquare:     { key: 'foursquare',     label: 'Foursquare',              domain: 'foursquare.com',    strategy: 'auto', unsupported: 'measured 0% found across 34 businesses, on two runs including a re-check under the corrected scanner — never once located a listing' },
  nextdoor:       { key: 'nextdoor',       label: 'Nextdoor',                domain: 'nextdoor.com',      strategy: 'auto' },
  manta:          { key: 'manta',          label: 'Manta',                   domain: 'manta.com',         strategy: 'auto', unsupported: 'measured 21% found across 34 businesses — below the 25% bar on two separate runs (24%, 21%)' },
  merchantcircle: { key: 'merchantcircle', label: 'Merchant Circle',         domain: 'merchantcircle.com',strategy: 'auto', unsupported: 'measured 3% found across 34 businesses, re-checked under the corrected scanner' },
  trustpilot:     { key: 'trustpilot',     label: 'Trustpilot',              domain: 'trustpilot.com',    strategy: 'auto', unsupported: 'measured 3% found across 34 businesses, re-checked under the corrected scanner' },
  linkedin:       { key: 'linkedin',       label: 'LinkedIn',                domain: 'linkedin.com',      strategy: 'snippet' },

  // ── Found by mining brand queries, not by assumption ────────────────────
  // The original registry was assembled from what we expected to matter. These
  // came out of the SERP data itself: domains appearing for many unrelated
  // businesses across different industries and states. MapQuest appeared for 27
  // of 34 — a higher hit rate than most of the original core set, and it was
  // simply missing.
  mapquest:       { key: 'mapquest',       label: 'MapQuest',                domain: 'mapquest.com',      strategy: 'auto' },
  birdeye:        { key: 'birdeye',        label: 'BirdEye',                 domain: 'birdeye.com',       strategy: 'auto' },
  yahoolocal:     { key: 'yahoolocal',     label: 'Yahoo Local',             domain: 'local.yahoo.com',   strategy: 'auto' },
  alignable:      { key: 'alignable',      label: 'Alignable',               domain: 'alignable.com',     strategy: 'auto', unsupported: 'measured 6% found across 34 businesses (20 of 34 unverified)' },

  // ── Home Services ───────────────────────────────────────────────────────
  angi:           { key: 'angi',           label: 'Angi',                    domain: 'angi.com',          strategy: 'auto', vertical: 'home' },
  houzz:          { key: 'houzz',          label: 'Houzz',                   domain: 'houzz.com',         strategy: 'auto', vertical: 'home' },
  thumbtack:      { key: 'thumbtack',      label: 'Thumbtack',               domain: 'thumbtack.com',     strategy: 'auto', vertical: 'home' },
  porch:          { key: 'porch',          label: 'Porch',                   domain: 'porch.com',         strategy: 'auto', vertical: 'home', unsupported: 'measured 13% found across 8 home-services businesses under the corrected scanner' },
  homeadvisor:    { key: 'homeadvisor',    label: 'HomeAdvisor',             domain: 'homeadvisor.com',   strategy: 'auto', vertical: 'home' },
  bark:           { key: 'bark',           label: 'Bark',                    domain: 'bark.com',          strategy: 'auto', vertical: 'home', unsupported: 'measured 0% found across 8 home-services businesses' },

  // ── Health & Fitness ────────────────────────────────────────────────────
  healthgrades:   { key: 'healthgrades',   label: 'Healthgrades',            domain: 'healthgrades.com',  strategy: 'auto', vertical: 'health' },
  zocdoc:         { key: 'zocdoc',         label: 'ZocDoc',                  domain: 'zocdoc.com',        strategy: 'auto', vertical: 'health' },
  webmd:          { key: 'webmd',          label: 'WebMD',                   domain: 'doctor.webmd.com',  strategy: 'auto', vertical: 'health' },
  vitals:         { key: 'vitals',         label: 'Vitals',                  domain: 'vitals.com',        strategy: 'auto', vertical: 'health' },
  ratemds:        { key: 'ratemds',        label: 'RateMDs',                 domain: 'ratemds.com',       strategy: 'auto', vertical: 'health' },

  // ── Legal ───────────────────────────────────────────────────────────────
  avvo:           { key: 'avvo',           label: 'Avvo',                    domain: 'avvo.com',          strategy: 'auto', vertical: 'legal', unsupported: 'measured 13% found across 8 law firms' },
  justia:         { key: 'justia',         label: 'Justia',                  domain: 'lawyers.justia.com',strategy: 'auto', vertical: 'legal' },
  findlaw:        { key: 'findlaw',        label: 'FindLaw',                 domain: 'lawyers.findlaw.com',strategy: 'auto', vertical: 'legal' },
  lawyers:        { key: 'lawyers',        label: 'Lawyers.com',             domain: 'lawyers.com',       strategy: 'auto', vertical: 'legal' },
  superlawyers:   { key: 'superlawyers',   label: 'Super Lawyers',           domain: 'superlawyers.com',  strategy: 'auto', vertical: 'legal' },

  // ── Food & Beverage ─────────────────────────────────────────────────────
  tripadvisor:    { key: 'tripadvisor',    label: 'TripAdvisor',             domain: 'tripadvisor.com',   strategy: 'auto', vertical: 'food' },
  opentable:      { key: 'opentable',      label: 'OpenTable',               domain: 'opentable.com',     strategy: 'auto', vertical: 'food' },
  zomato:         { key: 'zomato',         label: 'Zomato',                  domain: 'zomato.com',        strategy: 'auto', vertical: 'food', unsupported: 'measured 0% found across 8 food businesses' },
  happycow:       { key: 'happycow',       label: 'HappyCow',                domain: 'happycow.net',      strategy: 'auto', vertical: 'food' },

  // ── Beauty & Personal Care ──────────────────────────────────────────────
  vagaro:         { key: 'vagaro',         label: 'Vagaro',                  domain: 'vagaro.com',        strategy: 'auto', vertical: 'beauty', unsupported: 'measured 0% found across 8 beauty businesses' },
  mindbody:       { key: 'mindbody',       label: 'Mindbody',                domain: 'mindbodyonline.com',strategy: 'auto', vertical: 'beauty', unsupported: 'measured 0% found across 8 beauty businesses' },
  styleseat:      { key: 'styleseat',      label: 'StyleSeat',               domain: 'styleseat.com',     strategy: 'auto', vertical: 'beauty', unsupported: 'measured 0% found across 8 beauty businesses' },
  // Beauty lost all three of its original directories to measurement, leaving
  // those businesses with the core set only. Fresha surfaced in the brand-query
  // mining and is a real booking platform for salons and spas.
  fresha:         { key: 'fresha',         label: 'Fresha',                  domain: 'fresha.com',        strategy: 'auto', vertical: 'beauty' },

  // ── Automotive ──────────────────────────────────────────────────────────
  repairpal:      { key: 'repairpal',      label: 'RepairPal',               domain: 'repairpal.com',     strategy: 'auto', vertical: 'auto', unsupported: 'measured 0% found across 8 automotive businesses' },
  carwise:        { key: 'carwise',        label: 'CarWise',                 domain: 'carwise.com',       strategy: 'auto', vertical: 'auto' },

  // ── Professional Services ───────────────────────────────────────────────
  expertise:      { key: 'expertise',      label: 'Expertise.com',           domain: 'expertise.com',     strategy: 'auto', vertical: 'professional', unsupported: 'measured 13% found across 8 professional-services businesses' },
  zoominfo:       { key: 'zoominfo',       label: 'ZoomInfo',                domain: 'zoominfo.com',      strategy: 'auto', vertical: 'professional' },
  clutch:         { key: 'clutch',         label: 'Clutch',                  domain: 'clutch.co',         strategy: 'auto', vertical: 'professional' },

  // ── Real Estate ─────────────────────────────────────────────────────────
  zillow:         { key: 'zillow',         label: 'Zillow',                  domain: 'zillow.com',        strategy: 'auto', vertical: 'realestate' },
  realtor:        { key: 'realtor',        label: 'Realtor.com',             domain: 'realtor.com',       strategy: 'auto', vertical: 'realestate' },
  trulia:         { key: 'trulia',         label: 'Trulia',                  domain: 'trulia.com',        strategy: 'auto', vertical: 'realestate', unsupported: 'measured 0% found across 8 real-estate businesses' },
};

/** Directories we can actually scan — excludes unauditable AND unsupported. */
export function auditableDirectories(keys: string[]): DirectoryDef[] {
  return keys
    .map((k) => DIRECTORIES[k])
    .filter((d): d is DirectoryDef => !!d && !d.unauditable && !d.unsupported);
}

/**
 * The directories actually scanned for a business: the core set plus the ones
 * serving its industry, minus everything measurement disqualified.
 */
export function directoriesForVertical(vertical: Vertical | null): DirectoryDef[] {
  return Object.values(DIRECTORIES).filter(
    (d) => !d.unauditable && !d.unsupported && (!d.vertical || d.vertical === vertical),
  );
}

/** Dropped on evidence, with the measured reason. Surfaced in docs, not to customers. */
export const UNSUPPORTED = Object.values(DIRECTORIES)
  .filter((d) => d.unsupported)
  .map((d) => ({ key: d.key, label: d.label, reason: d.unsupported! }));

/** The ones the customer must claim themselves (#173). */
export const UNAUDITABLE_KEYS = Object.values(DIRECTORIES)
  .filter((d) => d.unauditable)
  .map((d) => d.key);


/**
 * Maps an industry GROUP (from industry.config) onto a citation vertical.
 *
 * The two lists are maintained separately, so this is the seam between them.
 * NOTE: `Real Estate` has no industries assigned to it in INDUSTRY_MAP, so
 * Zillow/Realtor/Trulia are currently unreachable in production regardless of
 * what this returns — tracked separately rather than papered over here.
 */
const GROUP_TO_VERTICAL: Record<string, Vertical> = {
  'Home Services': 'home',
  'Health & Fitness': 'health',
  'Legal': 'legal',
  'Food & Beverage': 'food',
  'Beauty & Personal Care': 'beauty',
  'Automotive': 'auto',
  'Professional Services': 'professional',
  'Real Estate': 'realestate',
};

export function verticalForGroup(group: string | null | undefined): Vertical | null {
  return (group && GROUP_TO_VERTICAL[group]) || null;
}
