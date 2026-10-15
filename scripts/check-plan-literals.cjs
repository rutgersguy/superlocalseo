// Runtime source must derive advertised plan prices from the catalog. Historical
// docs, migrations, tests and legacy Stripe environment IDs remain legitimate.
const fs = require('fs'); const path = require('path'); const failures=[];
function walk(dir) { for(const e of fs.readdirSync(dir,{withFileTypes:true})) {const p=path.join(dir,e.name);if(e.isDirectory()){if(!['__tests__','migrations'].includes(e.name))walk(p);}else if(/\.(tsx?|html)$/.test(e.name)){const text=fs.readFileSync(p,'utf8');if(/\$(?:99|199|399|149|349|499|79|59)(?!\d)/.test(text))failures.push(p);if(/\.tsx?$/.test(p)&&text.includes("'2026-10'"))failures.push(p+' (catalog version literal)');}}}
walk('backend/src');walk('frontend/src');if(failures.length){console.error(failures.join('\n'));process.exit(1);}console.log('Runtime plan price/version literal check passed');
