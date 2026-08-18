/**
 * Final measurement for #174: the union method, over the frozen corpus.
 *
 * Runs the real `scanLocation()` — brand query unioned with per-directory
 * `site:` search, with host matching and the category-page gate — so what is
 * measured here is exactly what ships. Same 34 businesses as the two
 * single-method runs, so the three are directly comparable.
 *
 * The output decides the advertised directory set. A directory earns its place
 * by finding listings, not by appearing in a config file.
 */
import { readFileSync } from 'fs';
import { scanLocation, CitationScanResult } from '../services/citation_scan.service';
import { directoriesForVertical, Vertical } from '../config/directories.config';
import { LocationNap } from '../services/citation_scan.service';

interface Row extends LocationNap { vertical: Vertical }
const CORPUS: Row[] = JSON.parse(readFileSync(process.env.CORPUS ?? '/corpus/corpus.json', 'utf8'));
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 5);

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
  console.log(`corpus: ${CORPUS.length} businesses\n`);
  let done = 0;
  const all = await pool(CORPUS, CONCURRENCY, async (loc) => {
    const dirs = directoriesForVertical(loc.vertical);
    const res = await scanLocation(loc, dirs);
    const l = res.filter((r) => r.status === 'listed').length;
    console.log(`  [${++done}/${CORPUS.length}] ${loc.name.slice(0, 36).padEnd(36)} listed=${String(l).padStart(2)}/${dirs.length}`);
    return { loc, res };
  });

  const tally = new Map<string, { listed: number; not_found: number; unverified: number; mismatch: number; napless: number; samples: string[] }>();
  for (const b of all) {
    if (!b || !b.res) continue;
    for (const r of b.res as CitationScanResult[]) {
      const t = tally.get(r.directory) ?? { listed: 0, not_found: 0, unverified: 0, mismatch: 0, napless: 0, samples: [] };
      t[r.status]++;
      if (r.status === 'listed') {
        if (r.napUnreadable) t.napless++;
        if (r.addressMatch === false || r.phoneMatch === false) t.mismatch++;
        if (t.samples.length < 2 && r.listingUrl) t.samples.push(r.listingUrl);
      }
      tally.set(r.directory, t);
    }
  }

  console.log('\n=== UNION method, per directory ===');
  console.log('directory         n  listed  not_found  unverified   listed%   NAP-read  NAP-mismatch');
  const rows = [...tally.entries()].map(([key, t]) => {
    const n = t.listed + t.not_found + t.unverified;
    return { key, t, n, pct: (t.listed / n) * 100 };
  }).sort((a, b) => b.pct - a.pct);
  for (const r of rows) {
    console.log(`${r.key.padEnd(16)}${String(r.n).padStart(3)}${String(r.t.listed).padStart(8)}${String(r.t.not_found).padStart(11)}${String(r.t.unverified).padStart(12)}   ${r.pct.toFixed(0).padStart(5)}%   ${String(r.t.listed - r.t.napless).padStart(7)}   ${String(r.t.mismatch).padStart(9)}`);
  }

  console.log('\n=== sample listing URLs ===');
  for (const r of rows.filter((x) => x.t.listed > 0)) {
    console.log(`  ${r.key.padEnd(15)} ${(r.t.samples[0] ?? '').slice(0, 95)}`);
  }

  console.log('\nJSON ' + JSON.stringify(rows.map((r) => ({ key: r.key, n: r.n, listed: r.t.listed, napRead: r.t.listed - r.t.napless, not_found: r.t.not_found, unverified: r.t.unverified, mismatch: r.t.mismatch, pct: Math.round(r.pct) }))));
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
