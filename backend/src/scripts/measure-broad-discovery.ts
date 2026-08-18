/**
 * Head-to-head: one broad brand query vs one `site:` query per directory (#174).
 *
 * WHY THE `site:` APPROACH IS SUSPECT
 * -----------------------------------
 * `site:manta.com Anytime Plumber Beattyville` returns nothing, while
 * `site:manta.com plumber` returns that very page. Google does not guarantee
 * complete `site:` results, so a `not_found` built on one is unreliable — and
 * an unreliable not_found is the error that hurts customers, because it tells
 * them to create a listing that already exists.
 *
 * THE ALTERNATIVE
 * ---------------
 * Query the brand once, quoted, at depth 100, and see which directory domains
 * appear. For Aire Serv that surfaced 9 directories for $0.0065 where 17
 * `site:` queries surfaced 5.
 *
 * This script runs the broad method over the frozen corpus so its per-directory
 * hit rate can be compared against the `site:` baseline on identical inputs.
 * Both numbers are needed: whichever wins, the shipped directory set should be
 * decided on measurement rather than on which approach was written first.
 */
import { readFileSync } from 'fs';
import { serpSearch } from '../services/dataforseo.service';
import { DIRECTORIES, directoriesForVertical, Vertical } from '../config/directories.config';
import { isSameBusiness, LocationNap } from '../services/citation_scan.service';

interface Row extends LocationNap { vertical: Vertical }

const CORPUS: Row[] = JSON.parse(readFileSync(process.env.CORPUS ?? '/corpus/corpus.json', 'utf8'));
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 6);
const DEPTH = Number(process.env.DEPTH ?? 100);

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
  console.log(`corpus: ${CORPUS.length} businesses | depth ${DEPTH}\n`);

  let done = 0;
  const perBusiness = await pool(CORPUS, CONCURRENCY, async (loc) => {
    const q = `"${loc.name}" ${loc.city} ${loc.state}`;
    const results = await serpSearch(q, DEPTH);
    const relevant = directoriesForVertical(loc.vertical);

    const hits = new Map<string, { url: string; identity: boolean }>();
    for (const r of results) {
      for (const d of relevant) {
        if (!r.url.includes(d.domain.split('/')[0])) continue;
        if (hits.has(d.key)) continue;
        const identity = isSameBusiness(loc, `${r.title} ${r.description}`, r.url);
        hits.set(d.key, { url: r.url, identity });
      }
    }
    console.log(`  [${++done}/${CORPUS.length}] ${loc.name.slice(0, 38).padEnd(38)} results=${String(results.length).padStart(3)}  dirs=${hits.size}`);
    return { loc, relevant: relevant.map((d) => d.key), hits };
  });

  const found = new Map<string, number>();     // matched domain AND passed identity
  const domainOnly = new Map<string, number>(); // matched domain, failed identity
  const eligible = new Map<string, number>();
  const samples = new Map<string, string[]>();

  for (const b of perBusiness) {
    if (!b || !b.relevant) continue;
    for (const k of b.relevant) eligible.set(k, (eligible.get(k) ?? 0) + 1);
    for (const [k, v] of b.hits) {
      if (v.identity) {
        found.set(k, (found.get(k) ?? 0) + 1);
        const s = samples.get(k) ?? []; if (s.length < 3) { s.push(v.url); samples.set(k, s); }
      } else {
        domainOnly.set(k, (domainOnly.get(k) ?? 0) + 1);
      }
    }
  }

  console.log('\n=== broad-query discovery, per directory ===');
  console.log('directory        eligible  found  rejected-identity   found%');
  const rows = [...eligible.entries()].map(([k, n]) => ({
    k, n, f: found.get(k) ?? 0, r: domainOnly.get(k) ?? 0, pct: ((found.get(k) ?? 0) / n) * 100,
  })).sort((a, b) => b.pct - a.pct);
  for (const r of rows) {
    console.log(`${r.k.padEnd(16)}${String(r.n).padStart(8)}${String(r.f).padStart(7)}${String(r.r).padStart(20)}   ${r.pct.toFixed(0).padStart(5)}%`);
  }

  console.log('\n=== sample URLs (check these are BUSINESS pages, not category pages) ===');
  for (const r of rows.filter((x) => x.f > 0)) {
    console.log(`  ${r.k}:`);
    for (const u of samples.get(r.k) ?? []) console.log(`     ${u.slice(0, 100)}`);
  }

  console.log('\nJSON ' + JSON.stringify(rows));
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
