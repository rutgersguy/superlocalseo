import { DIRECTORIES, directoriesForVertical, UNSUPPORTED, UNAUDITABLE_KEYS, Vertical } from '../config/directories.config';
const verticals: Vertical[] = ['home','health','legal','food','beauty','auto','professional','realestate'];
console.log('total defined      :', Object.keys(DIRECTORIES).length);
console.log('unauditable (claim):', UNAUDITABLE_KEYS.join(', '));
console.log('dropped on evidence:', UNSUPPORTED.length);
const core = directoriesForVertical(null).map((d) => d.key);
console.log('\ncore scanned (' + core.length + '):', core.join(', '));
for (const v of verticals) {
  const all = directoriesForVertical(v).map((d) => d.key);
  const extra = all.filter((k: string) => !core.includes(k));
  console.log(`${v.padEnd(13)} total=${String(all.length).padStart(2)}  +${extra.join(', ') || '(none)'}`);
}
console.log('\nDROPPED:');
for (const d of UNSUPPORTED) console.log(`  ${d.key.padEnd(15)} ${d.reason}`);
