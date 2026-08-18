/**
 * Vertical-directory coverage on a per-vertical corpus (#174).
 *
 * The main run judged vertical directories on 2–6 businesses each, because the
 * corpus was built for breadth. Avvo scoring 0% on four law firms is not
 * evidence Avvo is unreachable; it is barely evidence of anything. This builds
 * a dedicated corpus per vertical so the decision to advertise a directory
 * rests on a sample that can support it.
 *
 * Scans ONLY that vertical's directories — the core ones were already measured
 * on all 34 businesses and do not need re-running.
 */
import { mapsSearch } from '../services/dataforseo.service';
import { scanLocation, LocationNap } from '../services/citation_scan.service';
import { DIRECTORIES, Vertical } from '../config/directories.config';

const SEEDS: Record<Vertical, string[]> = {
  home: ['plumber Phoenix AZ', 'hvac contractor Tulsa OK', 'roofing contractor Denver CO', 'electrician Tampa FL'],
  health: ['dentist Austin TX', 'dermatologist Miami FL', 'chiropractor Portland OR', 'pediatrician Raleigh NC'],
  legal: ['personal injury lawyer Chicago IL', 'family law attorney Atlanta GA', 'criminal defense attorney Dallas TX', 'estate planning attorney Denver CO'],
  food: ['pizza restaurant New York NY', 'mexican restaurant San Diego CA', 'coffee shop Seattle WA', 'italian restaurant Boston MA'],
  beauty: ['hair salon Nashville TN', 'day spa Scottsdale AZ', 'nail salon Orlando FL', 'barber shop Austin TX'],
  auto: ['auto repair shop Houston TX', 'collision repair Columbus OH', 'tire shop Kansas City MO', 'transmission repair Phoenix AZ'],
  professional: ['accountant Charlotte NC', 'insurance agency Des Moines IA', 'marketing agency Austin TX', 'financial advisor Boise ID'],
  realestate: ['real estate agent Boise ID', 'realtor Sarasota FL', 'real estate agency Scottsdale AZ', 'realtor Nashville TN'],
};

const PER_SEED = Number(process.env.PER_SEED ?? 2);
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 4);

function splitAddress(full: string) {
  const m = full.match(/^(.*),\s*([^,]+),\s*([A-Z]{2})\s*(\d{5})/);
  return m ? { address: m[1].trim(), city: m[2].trim(), state: m[3], zip: m[4] } : null;
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
  // VERTICALS=beauty,legal limits the run — the full sweep is 8 verticals and
  // there is no reason to re-measure all of them to answer one question.
  const only = (process.env.VERTICALS ?? '').split(',').map((v) => v.trim()).filter(Boolean);
  const verticals = (Object.keys(SEEDS) as Vertical[]).filter((v) => !only.length || only.includes(v));
  const tally = new Map<string, { listed: number; not_found: number; unverified: number; napless: number }>();

  for (const vertical of verticals) {
    const dirs = Object.values(DIRECTORIES).filter((d) => d.vertical === vertical);
    if (dirs.length === 0) continue;

    const corpus: Array<LocationNap> = [];
    for (const q of SEEDS[vertical]) {
      const items = await mapsSearch(q);
      let taken = 0;
      for (const i of items) {
        if (taken >= PER_SEED) break;
        if (!i.title || !i.address || !i.phone) continue;
        const parts = splitAddress(i.address);
        if (!parts) continue;
        corpus.push({ name: i.title, ...parts, phone: i.phone });
        taken++;
      }
    }

    console.log(`\n=== ${vertical}: ${corpus.length} businesses × ${dirs.length} directories (${dirs.map((d) => d.key).join(', ')}) ===`);

    const results = await pool(corpus, CONCURRENCY, (loc) => scanLocation(loc, dirs));
    for (const rs of results) {
      if (!Array.isArray(rs)) continue;
      for (const r of rs) {
        const t = tally.get(r.directory) ?? { listed: 0, not_found: 0, unverified: 0, napless: 0 };
        t[r.status]++;
        if (r.status === 'listed' && r.napUnreadable) t.napless++;
        tally.set(r.directory, t);
      }
    }
    for (const d of dirs) {
      const t = tally.get(d.key);
      if (t) console.log(`  ${d.key.padEnd(15)} listed=${t.listed} not_found=${t.not_found} unverified=${t.unverified}`);
    }
  }

  console.log('\n=== vertical directories, larger sample ===');
  console.log('directory         n  listed  not_found  unverified   listed%  answer%');
  const rows = [...tally.entries()].map(([key, t]) => {
    const n = t.listed + t.not_found + t.unverified;
    return { key, t, n, pct: (t.listed / n) * 100, ans: ((t.listed + t.not_found) / n) * 100 };
  }).sort((a, b) => b.pct - a.pct);
  for (const r of rows) {
    console.log(`${r.key.padEnd(16)}${String(r.n).padStart(3)}${String(r.t.listed).padStart(8)}${String(r.t.not_found).padStart(11)}${String(r.t.unverified).padStart(12)}   ${r.pct.toFixed(0).padStart(5)}%  ${r.ans.toFixed(0).padStart(6)}%`);
  }
  console.log('\nJSON ' + JSON.stringify(rows.map((r) => ({ key: r.key, n: r.n, ...r.t, pct: Math.round(r.pct) }))));
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
