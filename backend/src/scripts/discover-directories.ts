/**
 * Which directories are we NOT tracking? (#174)
 *
 * The 42-entry registry was assembled from what we expected to matter. This
 * asks the data instead: run each corpus business's brand query and tally every
 * domain that comes back, minus the ones we already know about.
 *
 * A domain that appears for MANY unrelated businesses — different industries,
 * different states — is a directory. One that appears for a single business is
 * its own site, a local news mention, or a customer. So the ranking metric is
 * "distinct businesses", never "total hits".
 *
 * This only surfaces directories we can actually SEE. That is the right filter:
 * a directory invisible to the brand query is one we could not audit anyway.
 */
import { readFileSync } from 'fs';
import { serpSearch, mapsSearch } from '../services/dataforseo.service';
import { DIRECTORIES, Vertical } from '../config/directories.config';
import { LocationNap } from '../services/citation_scan.service';

interface Row extends LocationNap { vertical: Vertical }
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 5);

/**
 * SEEDS builds a fresh corpus from Google Maps instead of reading the frozen
 * one — needed to mine a single industry, e.g. finding beauty directories after
 * Vagaro, Mindbody and StyleSeat all measured 0% (#185). Comma-separated
 * queries, e.g. SEEDS="hair salon Nashville TN,day spa Scottsdale AZ".
 */
const SEEDS = (process.env.SEEDS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const PER_SEED = Number(process.env.PER_SEED ?? 2);

function splitAddress(full: string) {
  const m = full.match(/^(.*),\s*([^,]+),\s*([A-Z]{2})\s*(\d{5})/);
  return m ? { address: m[1].trim(), city: m[2].trim(), state: m[3], zip: m[4] } : null;
}

async function buildCorpus(): Promise<Row[]> {
  const out: Row[] = [];
  for (const q of SEEDS) {
    const items = await mapsSearch(q);
    let taken = 0;
    for (const i of items) {
      if (taken >= PER_SEED) break;
      if (!i.title || !i.address || !i.phone) continue;
      const parts = splitAddress(i.address);
      if (!parts) continue;
      out.push({ name: i.title, ...parts, phone: i.phone, vertical: (process.env.VERTICAL ?? 'home') as Vertical });
      taken++;
    }
  }
  return out;
}

/** 3+ unrelated businesses by default; lower it for a small single-industry corpus. */
const MIN_HITS = Number(process.env.MIN_HITS ?? 3);

const KNOWN = new Set(Object.values(DIRECTORIES).map((d) => d.domain.split('/')[0].replace(/^www\./, '')));

/**
 * Not citation directories, however often they rank for a brand query.
 *
 * The job boards are here because they dominated the first run — SimplyHired,
 * Monster, JobLeads, beBee, WayUp and RocketReach all cleared the threshold.
 * They rank for a business name because the business posts vacancies, which
 * says nothing about its NAP and would be worthless to audit.
 */
const NOISE = new RegExp(
  '^(' + [
    // search, social, general content
    'google\\.', 'youtube\\.', 'bing\\.', 'duckduckgo\\.', 'yandex\\.', 'wikipedia\\.',
    'amazon\\.', 'ebay\\.', 'reddit\\.', 'x\\.com', 'twitter\\.', 'instagram\\.',
    'tiktok\\.', 'pinterest\\.', 'threads\\.',
    // recruitment and people-data — a job posting is not a citation
    'glassdoor\\.', 'indeed\\.', 'ziprecruiter\\.', 'simplyhired\\.', 'monster\\.',
    'jobleads\\.', 'bebee\\.', 'wayup\\.', 'vaia\\.', 'rocketreach\\.', 'idcrawl\\.',
    'talent\\.', 'lensa\\.', 'snagajob\\.',
  ].join('|') + ')',
);

function host(url: string): string | null {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return null; }
}

/** Strips the business's own site — it ranks first for its own name, obviously. */
function isOwnSite(h: string, name: string): boolean {
  const slug = h.split('.')[0].replace(/[^a-z0-9]/g, '');
  const tokens = name.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 4);
  return tokens.some((t) => slug.includes(t));
}

async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cur = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    for (;;) {
      const i = cur++;
      if (i >= items.length) return;
      try { out[i] = await fn(items[i]); } catch (e) { out[i] = { error: (e as Error).message } as unknown as R; }
    }
  }));
  return out;
}

async function main() {
  const CORPUS: Row[] = SEEDS.length
    ? await buildCorpus()
    : JSON.parse(readFileSync(process.env.CORPUS ?? '/corpus/corpus.json', 'utf8'));
  console.log(`mining ${CORPUS.length} brand queries for untracked directories\n`);
  let done = 0;

  const perBusiness = await pool(CORPUS, CONCURRENCY, async (loc) => {
    const where = [loc.city, loc.state].filter(Boolean).join(' ');
    const results = await serpSearch(`"${loc.name}" ${where}`.trim(), 100);
    const hosts = new Map<string, string>();
    for (const r of results) {
      const h = host(r.url);
      if (!h || NOISE.test(h) || isOwnSite(h, loc.name)) continue;
      const base = h.split('.').slice(-2).join('.');
      if (KNOWN.has(base) || KNOWN.has(h)) continue;
      if (!hosts.has(base)) hosts.set(base, r.url);
    }
    console.log(`  [${++done}/${CORPUS.length}] ${loc.name.slice(0, 34).padEnd(34)} untracked=${hosts.size}`);
    return { vertical: loc.vertical, hosts };
  });

  const businesses = new Map<string, number>();
  const verticals = new Map<string, Set<string>>();
  const sample = new Map<string, string>();

  for (const b of perBusiness) {
    if (!b || !b.hosts) continue;
    for (const [h, url] of b.hosts) {
      businesses.set(h, (businesses.get(h) ?? 0) + 1);
      if (!verticals.has(h)) verticals.set(h, new Set());
      verticals.get(h)!.add(b.vertical);
      if (!sample.has(h)) sample.set(h, url);
    }
  }

  const rows = [...businesses.entries()]
    .map(([h, n]) => ({ h, n, v: verticals.get(h)!.size }))
    .filter((r) => r.n >= MIN_HITS)
    .sort((a, b) => b.n - a.n);

  console.log(`\n=== untracked domains appearing for 3+ businesses (of ${CORPUS.length}) ===`);
  console.log('domain                          businesses  verticals  sample');
  for (const r of rows) {
    console.log(`${r.h.padEnd(32)}${String(r.n).padStart(5)}${String(r.v).padStart(11)}  ${(sample.get(r.h) ?? '').slice(0, 70)}`);
  }
  console.log('\nJSON ' + JSON.stringify(rows));
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
