/**
 * Validation harness for the citation scanner (issue #174).
 *
 *   docker exec superlocalseo-api node dist/scripts/validate-citation-scan.js
 *
 * Runs the REAL scanner against real businesses and reports the per-directory
 * outcome, so we know the actual hit rate before a customer ever sees it.
 *
 * This exists because the feature it replaces was silently wrong for three
 * months (#149). A citation audit that confidently reports the wrong thing is
 * worse than one that reports nothing, so the bar is: every directory is either
 * demonstrably working, or honestly marked `unverified`.
 *
 * ⚠️ Spends real DataForSEO credit — roughly $0.01 per directory per business.
 * A full run over 42 directories and 2 businesses is about $0.85.
 */
import { DIRECTORIES } from '../config/directories.config';
import { scanLocation, LocationNap, CitationScanResult } from '../services/citation_scan.service';

/**
 * Known businesses with hand-verified NAP.
 *
 * The first is the one with BrightLocal ground truth from May, so its results
 * can be compared against what the old vendor reported.
 */
const SUBJECTS: Array<{ label: string; loc: LocationNap }> = [
  {
    label: 'Aire Serv of South Tulsa (HVAC, has BrightLocal ground truth)',
    loc: {
      name: 'Aire Serv of South Tulsa',
      address: '505 N Armstrong St Suite Ab',
      city: 'Bixby', state: 'OK', zip: '74008',
      phone: '(918) 518-1492',
    },
  },
  {
    label: "Joe's Pizza (well-known, dense listing coverage)",
    loc: {
      name: "Joe's Pizza",
      address: '7 Carmine St',
      city: 'New York', state: 'NY', zip: '10014',
      phone: '(212) 366-1182',
    },
  },
];

function summarise(results: CitationScanResult[]) {
  const by = { listed: 0, not_found: 0, unverified: 0 } as Record<string, number>;
  for (const r of results) by[r.status] += 1;
  return by;
}

async function main(): Promise<void> {
  const only = process.env.ONLY_DIRECTORIES?.split(',').map((s) => s.trim()).filter(Boolean);
  const dirs = Object.values(DIRECTORIES).filter(
    (d) => !d.unauditable && (!only || only.includes(d.key)),
  );

  console.log(`\nValidating ${dirs.length} directories x ${SUBJECTS.length} businesses`);
  console.log(`Estimated cost: ~$${(dirs.length * SUBJECTS.length * 0.01).toFixed(2)}\n`);

  const totals: Record<string, Record<string, number>> = {};

  for (const subject of SUBJECTS) {
    console.log(`\n=== ${subject.label} ===`);
    const results = await scanLocation(subject.loc, dirs);

    for (const r of results) {
      totals[r.directory] ??= { listed: 0, not_found: 0, unverified: 0 };
      totals[r.directory][r.status] += 1;

      const nap = r.status === 'listed'
        ? `name=${r.nameMatch} addr=${r.addressMatch} phone=${r.phoneMatch}`
        : (r.unverifiedReason ?? '');
      console.log(`  ${r.directory.padEnd(16)} ${r.status.padEnd(11)} ${nap}`);
      if (r.status === 'listed' && r.addressMatch === false) {
        console.log(`      expected: ${subject.loc.address}`);
        console.log(`      found   : ${r.foundAddress}`);
      }
    }
    console.log('  --', JSON.stringify(summarise(results)));
  }

  // A directory that is unverified for EVERY business is the signal that matters:
  // either our query/parse is wrong for it, or it should be dropped from the list.
  console.log('\n=== directories unverified for every business (need attention) ===');
  const bad = Object.entries(totals).filter(([, v]) => v.listed === 0 && v.not_found === 0);
  console.log(bad.length ? bad.map(([k]) => k).join(', ') : '  (none)');

  console.log('\n=== directories that produced a usable answer ===');
  const good = Object.entries(totals).filter(([, v]) => v.listed > 0);
  console.log(good.length ? good.map(([k, v]) => `${k}(${v.listed})`).join(', ') : '  (none)');
}

main()
  .then(() => process.exit(0))
  .catch((e) => { console.error('validation failed:', e); process.exit(1); });
