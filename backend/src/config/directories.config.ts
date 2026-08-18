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
  foursquare:     { key: 'foursquare',     label: 'Foursquare',              domain: 'foursquare.com',    strategy: 'auto' },
  nextdoor:       { key: 'nextdoor',       label: 'Nextdoor',                domain: 'nextdoor.com',      strategy: 'auto' },
  manta:          { key: 'manta',          label: 'Manta',                   domain: 'manta.com',         strategy: 'auto' },
  merchantcircle: { key: 'merchantcircle', label: 'Merchant Circle',         domain: 'merchantcircle.com',strategy: 'auto' },
  trustpilot:     { key: 'trustpilot',     label: 'Trustpilot',              domain: 'trustpilot.com',    strategy: 'auto' },
  linkedin:       { key: 'linkedin',       label: 'LinkedIn',                domain: 'linkedin.com',      strategy: 'snippet' },

  // ── Home Services ───────────────────────────────────────────────────────
  angi:           { key: 'angi',           label: 'Angi',                    domain: 'angi.com',          strategy: 'auto' },
  houzz:          { key: 'houzz',          label: 'Houzz',                   domain: 'houzz.com',         strategy: 'auto' },
  thumbtack:      { key: 'thumbtack',      label: 'Thumbtack',               domain: 'thumbtack.com',     strategy: 'auto' },
  porch:          { key: 'porch',          label: 'Porch',                   domain: 'porch.com',         strategy: 'auto' },
  homeadvisor:    { key: 'homeadvisor',    label: 'HomeAdvisor',             domain: 'homeadvisor.com',   strategy: 'auto' },
  bark:           { key: 'bark',           label: 'Bark',                    domain: 'bark.com',          strategy: 'auto' },

  // ── Health & Fitness ────────────────────────────────────────────────────
  healthgrades:   { key: 'healthgrades',   label: 'Healthgrades',            domain: 'healthgrades.com',  strategy: 'auto' },
  zocdoc:         { key: 'zocdoc',         label: 'ZocDoc',                  domain: 'zocdoc.com',        strategy: 'auto' },
  webmd:          { key: 'webmd',          label: 'WebMD',                   domain: 'doctor.webmd.com',  strategy: 'auto' },
  vitals:         { key: 'vitals',         label: 'Vitals',                  domain: 'vitals.com',        strategy: 'auto' },
  ratemds:        { key: 'ratemds',        label: 'RateMDs',                 domain: 'ratemds.com',       strategy: 'auto' },

  // ── Legal ───────────────────────────────────────────────────────────────
  avvo:           { key: 'avvo',           label: 'Avvo',                    domain: 'avvo.com',          strategy: 'auto' },
  justia:         { key: 'justia',         label: 'Justia',                  domain: 'lawyers.justia.com',strategy: 'auto' },
  findlaw:        { key: 'findlaw',        label: 'FindLaw',                 domain: 'lawyers.findlaw.com',strategy: 'auto' },
  lawyers:        { key: 'lawyers',        label: 'Lawyers.com',             domain: 'lawyers.com',       strategy: 'auto' },

  // ── Food & Beverage ─────────────────────────────────────────────────────
  tripadvisor:    { key: 'tripadvisor',    label: 'TripAdvisor',             domain: 'tripadvisor.com',   strategy: 'auto' },
  opentable:      { key: 'opentable',      label: 'OpenTable',               domain: 'opentable.com',     strategy: 'auto' },
  zomato:         { key: 'zomato',         label: 'Zomato',                  domain: 'zomato.com',        strategy: 'auto' },
  happycow:       { key: 'happycow',       label: 'HappyCow',                domain: 'happycow.net',      strategy: 'auto' },

  // ── Beauty & Personal Care ──────────────────────────────────────────────
  vagaro:         { key: 'vagaro',         label: 'Vagaro',                  domain: 'vagaro.com',        strategy: 'auto' },
  mindbody:       { key: 'mindbody',       label: 'Mindbody',                domain: 'mindbodyonline.com',strategy: 'auto' },
  styleseat:      { key: 'styleseat',      label: 'StyleSeat',               domain: 'styleseat.com',     strategy: 'auto' },

  // ── Automotive ──────────────────────────────────────────────────────────
  repairpal:      { key: 'repairpal',      label: 'RepairPal',               domain: 'repairpal.com',     strategy: 'auto' },
  carwise:        { key: 'carwise',        label: 'CarWise',                 domain: 'carwise.com',       strategy: 'auto' },

  // ── Professional Services ───────────────────────────────────────────────
  expertise:      { key: 'expertise',      label: 'Expertise.com',           domain: 'expertise.com',     strategy: 'auto' },
  zoominfo:       { key: 'zoominfo',       label: 'ZoomInfo',                domain: 'zoominfo.com',      strategy: 'auto' },

  // ── Real Estate ─────────────────────────────────────────────────────────
  zillow:         { key: 'zillow',         label: 'Zillow',                  domain: 'zillow.com',        strategy: 'auto' },
  realtor:        { key: 'realtor',        label: 'Realtor.com',             domain: 'realtor.com',       strategy: 'auto' },
  trulia:         { key: 'trulia',         label: 'Trulia',                  domain: 'trulia.com',        strategy: 'auto' },
};

/** Directories we can actually scan — everything except Apple Maps and Bing Places. */
export function auditableDirectories(keys: string[]): DirectoryDef[] {
  return keys
    .map((k) => DIRECTORIES[k])
    .filter((d): d is DirectoryDef => !!d && !d.unauditable);
}

/** The ones the customer must claim themselves (#173). */
export const UNAUDITABLE_KEYS = Object.values(DIRECTORIES)
  .filter((d) => d.unauditable)
  .map((d) => d.key);
