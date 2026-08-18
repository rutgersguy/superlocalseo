/**
 * Measures an explicit list of directory keys over the frozen corpus (#174).
 *
 * Exists because the first pass disqualified directories under code that was
 * later found to be wrong — phone extraction took page furniture, and an empty
 * `site:` result was being read as "not listed". Several verdicts moved once
 * those were fixed (ZocDoc 13% → 38%). A directory dropped on a buggy
 * measurement is still dropped on no evidence, so anything disqualified has to
 * be re-checked against the current scanner before the decision stands.
 *
 * Bypasses the `unsupported` filter deliberately: that is the flag under test.
 */
import { readFileSync } from 'fs';
import { scanLocation, LocationNap } from '../services/citation_scan.service';
import { DIRECTORIES, Vertical } from '../config/directories.config';

interface Row extends LocationNap { vertical: Vertical }
const CORPUS: Row[] = JSON.parse(readFileSync(process.env.CORPUS ?? '/corpus/corpus.json', 'utf8'));
const KEYS = (process.env.DIRS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 6);

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
  const dirs = KEYS.map((k) => DIRECTORIES[k]).filter(Boolean);
  console.log(`re-measuring ${dirs.map((d) => d.key).join(', ')} over ${CORPUS.length} businesses\n`);

  const tally = new Map<string, { listed: number; not_found: number; unverified: number }>();
  let done = 0;
  const all = await pool(CORPUS, CONCURRENCY, async (loc) => {
    const res = await scanLocation(loc, dirs);
    console.log(`  [${++done}/${CORPUS.length}] ${loc.name.slice(0, 34).padEnd(34)} ${res.map((r) => `${r.directory}=${r.status}`).join(' ')}`);
    return res;
  });

  for (const rs of all) {
    if (!Array.isArray(rs)) continue;
    for (const r of rs) {
      const t = tally.get(r.directory) ?? { listed: 0, not_found: 0, unverified: 0 };
      t[r.status]++;
      tally.set(r.directory, t);
    }
  }

  console.log('\n=== re-measured ===');
  console.log('directory         n  listed  not_found  unverified   listed%');
  for (const [k, t] of tally) {
    const n = t.listed + t.not_found + t.unverified;
    console.log(`${k.padEnd(16)}${String(n).padStart(3)}${String(t.listed).padStart(8)}${String(t.not_found).padStart(11)}${String(t.unverified).padStart(12)}   ${((t.listed / n) * 100).toFixed(0).padStart(5)}%`);
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
