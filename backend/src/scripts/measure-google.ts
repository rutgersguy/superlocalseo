/**
 * Google-only coverage over the frozen corpus (#174).
 *
 * Separated because my_business_info rate-limits far more aggressively than the
 * SERP endpoints — 12 concurrent calls yielded 1 success and 11 throttles — so
 * measuring it inside the parallel union harness produced a meaningless 0%.
 * Concurrency 2 here, and the client now retries throttles rather than reading
 * them as "no listing".
 *
 * NOTE ON WHAT THIS CAN AND CANNOT SHOW: the corpus NAP was itself taken from
 * Google Maps, so a NAP mismatch against Google is nearly impossible by
 * construction. This measures FINDABILITY only. Real customer data comes from
 * the customer, not from Google, which is exactly why mismatches show up in
 * production — Aire Serv's stored "Suite Ab" against Google's "Ste Ab".
 */
import { readFileSync } from 'fs';
import { scanDirectory, LocationNap } from '../services/citation_scan.service';
import { DIRECTORIES, Vertical } from '../config/directories.config';

interface Row extends LocationNap { vertical: Vertical }
const CORPUS: Row[] = JSON.parse(readFileSync(process.env.CORPUS ?? '/corpus/corpus.json', 'utf8'));

async function main() {
  const tally = { listed: 0, not_found: 0, unverified: 0 };
  const reasons: string[] = [];
  const queue = [...CORPUS];

  await Promise.all(Array.from({ length: 2 }, async () => {
    for (;;) {
      const loc = queue.shift();
      if (!loc) return;
      const r = await scanDirectory(loc, DIRECTORIES.google);
      tally[r.status]++;
      if (r.status !== 'listed') reasons.push(`${r.status.padEnd(10)} ${loc.name} — ${r.unverifiedReason ?? ''}`);
      console.log(`  ${r.status.padEnd(10)} ${loc.name.slice(0, 40).padEnd(40)} ${r.addressMatch === false ? 'ADDR-MISMATCH' : ''}`);
    }
  }));

  console.log('\n=== google over frozen corpus ===');
  console.log(JSON.stringify(tally), ` listed% = ${Math.round((tally.listed / CORPUS.length) * 100)}`);
  if (reasons.length) { console.log('\nnon-listed:'); reasons.forEach((r) => console.log('  ' + r)); }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
