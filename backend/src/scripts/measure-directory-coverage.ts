/**
 * Measures, per directory, whether we can consistently produce a TRUSTWORTHY
 * answer — the evidence behind which directories we advertise (#174).
 *
 * WHY THIS EXISTS
 * ---------------
 * The first validation run used two businesses. Two is enough to prove the
 * mechanism works and nowhere near enough to decide what to sell. A directory
 * that answered for both could still be guessing; one that missed both could
 * have been unlucky. Shipping "42 directories checked" on that basis would mean
 * telling customers to create listings that already exist — and duplicate
 * listings actively damage local ranking, so a false `not_found` leaves the
 * customer worse off than not running the audit at all.
 *
 * THE CORPUS IS REAL, AND ITS NAP IS AUTHORITATIVE
 * ------------------------------------------------
 * Businesses come from the Google Maps SERP, which returns name, address and
 * phone as Google holds them. So the input NAP is not invented and not ours —
 * it is the same record the directories are supposed to agree with.
 *
 * WHAT THIS DOES AND DOES NOT MEASURE
 * ------------------------------------
 * It measures ANSWER RATE: how often a directory yields listed/not_found rather
 * than unverified. That is a true lower bound on usability — a directory that
 * cannot answer cannot be sold.
 *
 * It does NOT prove a `not_found` is a true absence. Nothing search-based can,
 * without per-directory ground truth. That is why the promotion rule below
 * leans on `listed` rate as the positive signal, and why any directory that
 * answers only by saying "not found" is treated as unproven rather than good.
 *
 * Vertical directories are scored only against matching businesses. Avvo does
 * not list pizzerias, and counting that as a miss would measure nothing.
 */
import { mapsSearch } from '../services/dataforseo.service';
import { scanDirectory, LocationNap, CitationScanResult } from '../services/citation_scan.service';
import { directoriesForVertical, Vertical } from '../config/directories.config';

interface Corpus extends LocationNap { vertical: Vertical }

const SEEDS: Array<{ q: string; vertical: Vertical }> = [
  { q: 'plumber Phoenix AZ',                 vertical: 'home' },
  { q: 'hvac contractor Tulsa OK',           vertical: 'home' },
  { q: 'roofing contractor Denver CO',       vertical: 'home' },
  { q: 'dentist Austin TX',                  vertical: 'health' },
  { q: 'dermatologist Miami FL',             vertical: 'health' },
  { q: 'chiropractor Portland OR',           vertical: 'health' },
  { q: 'personal injury lawyer Chicago IL',  vertical: 'legal' },
  { q: 'family law attorney Atlanta GA',     vertical: 'legal' },
  { q: 'pizza restaurant New York NY',       vertical: 'food' },
  { q: 'mexican restaurant San Diego CA',    vertical: 'food' },
  { q: 'coffee shop Seattle WA',             vertical: 'food' },
  { q: 'hair salon Nashville TN',            vertical: 'beauty' },
  { q: 'day spa Scottsdale AZ',              vertical: 'beauty' },
  { q: 'auto repair shop Houston TX',        vertical: 'auto' },
  { q: 'collision repair Columbus OH',       vertical: 'auto' },
  { q: 'accountant Charlotte NC',            vertical: 'professional' },
  { q: 'real estate agent Boise ID',         vertical: 'realestate' },
];

const PER_SEED = Number(process.env.PER_SEED ?? 2);
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 8);

/** Splits "3636 E Anne St A, Phoenix, AZ 85040" into our stored shape. */
function splitAddress(full: string) {
  const m = full.match(/^(.*),\s*([^,]+),\s*([A-Z]{2})\s*(\d{5})/);
  if (!m) return null;
  return { address: m[1].trim(), city: m[2].trim(), state: m[3], zip: m[4] };
}

async function buildCorpus(): Promise<Corpus[]> {
  const out: Corpus[] = [];
  await pool(SEEDS, 4, async (seed) => {
    const items = await mapsSearch(seed.q);
    let taken = 0;
    for (const i of items) {
      if (taken >= PER_SEED) break;
      const { title, address: addr, phone } = i;
      if (!title || !addr || !phone) continue;
      const parts = splitAddress(addr);
      if (!parts) continue;
      out.push({ name: title, ...parts, phone, vertical: seed.vertical });
      taken++;
    }
  });
  return out;
}

async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    for (;;) {
      const i = cursor++;
      if (i >= items.length) return;
      try { results[i] = await fn(items[i]); }
      catch (e) { results[i] = { error: (e as Error).message } as unknown as R; }
    }
  }));
  return results;
}

interface Tally { listed: number; not_found: number; unverified: number; reasons: string[] }

async function main() {
  console.log('Building corpus from Google Maps…');
  const corpus = await buildCorpus();
  console.log(`corpus: ${corpus.length} real businesses\n`);
  for (const c of corpus) console.log(`  [${c.vertical}] ${c.name} — ${c.address}, ${c.city}, ${c.state} ${c.zip} — ${c.phone}`);

  const jobs: Array<{ loc: Corpus; dir: ReturnType<typeof directoriesForVertical>[number] }> = [];
  for (const loc of corpus) for (const dir of directoriesForVertical(loc.vertical)) jobs.push({ loc, dir });
  console.log(`\nscanning ${jobs.length} business×directory pairs at concurrency ${CONCURRENCY}…`);

  let done = 0;
  const results = await pool(jobs, CONCURRENCY, async (j) => {
    const r = await scanDirectory(j.loc, j.dir);
    if (++done % 50 === 0) console.log(`  …${done}/${jobs.length}`);
    return { key: j.dir.key, loc: j.loc, r: r as CitationScanResult };
  });

  const tally = new Map<string, Tally>();
  for (const x of results) {
    if (!x || !x.key) continue;
    const t = tally.get(x.key) ?? { listed: 0, not_found: 0, unverified: 0, reasons: [] };
    t[x.r.status]++;
    if (x.r.status === 'unverified' && x.r.unverifiedReason) t.reasons.push(x.r.unverifiedReason);
    tally.set(x.key, t);
  }

  console.log('\n=== per-directory coverage ===');
  console.log('directory        n   listed  not_found  unverified   listed%  answer%');
  const rows = [...tally.entries()].map(([key, t]) => {
    const n = t.listed + t.not_found + t.unverified;
    return { key, t, n, listedPct: (t.listed / n) * 100, answerPct: ((t.listed + t.not_found) / n) * 100 };
  }).sort((a, b) => b.listedPct - a.listedPct);

  for (const r of rows) {
    console.log(
      `${r.key.padEnd(16)}${String(r.n).padStart(2)}  ${String(r.t.listed).padStart(6)}  ${String(r.t.not_found).padStart(9)}  ${String(r.t.unverified).padStart(10)}   ${r.listedPct.toFixed(0).padStart(6)}%  ${r.answerPct.toFixed(0).padStart(6)}%`
    );
  }

  console.log('\n=== unverified reasons (top) ===');
  const reasons = new Map<string, number>();
  for (const r of rows) for (const x of r.t.reasons) {
    const k = x.replace(/[0-9]{2,}/g, 'N').slice(0, 60);
    reasons.set(k, (reasons.get(k) ?? 0) + 1);
  }
  for (const [k, v] of [...reasons.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log(`  ${String(v).padStart(3)}  ${k}`);

  console.log('\n=== proposed set (listed on >=40% AND answers >=80%) ===');
  console.log('KEEP :', rows.filter((r) => r.listedPct >= 40 && r.answerPct >= 80).map((r) => r.key).join(', ') || '(none)');
  console.log('DROP :', rows.filter((r) => !(r.listedPct >= 40 && r.answerPct >= 80)).map((r) => r.key).join(', ') || '(none)');

  console.log('\nJSON ' + JSON.stringify(rows.map((r) => ({ key: r.key, n: r.n, ...r.t, reasons: undefined }))));
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
