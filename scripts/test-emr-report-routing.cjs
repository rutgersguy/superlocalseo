const { readFileSync } = require('node:fs');
const { runInNewContext } = require('node:vm');
const assert = require('node:assert/strict');
const script = readFileSync('integrations/embedmyreviews/report-routing.html', 'utf8').match(/<script>([\s\S]*)<\/script>/)[1];
for (const [hostname, pathname, expected] of [
  ['app.superlocalseo.com','/intel-request','https://superlocalseo.com/audit'],
  ['app.superlocalseo.com','/intel-request/','https://superlocalseo.com/audit'],
  ['app.superlocalseo.com','/business-report/EvDT4hqzpNZ47BlhMjeTYUOVZXBmQ39XQcDX2A8nJHu8NmoBPVc1gsRYbBJvxm75','https://superlocalseo.com/audit?legacy=1'],
  ['app.superlocalseo.com','/business-report/../../dashboard',null],
  ['app.superlocalseo.com','/settings/application',null],
  ['app.superlocalseo.com','/sales-intelligence',null],
  ['app.superlocalseo.com','/login',null],
  ['app.superlocalseo.com','/connect/google',null],
  ['superlocalseo.com','/intel-request',null],
]) {
 let target = null;
 runInNewContext(script, { location: { hostname, pathname, search: '?email=private@example.test&redirect=https://example.test', replace: url => { target = url; } } });
 assert.equal(target, expected, pathname);
}
console.log('9 report routing cases passed; unrelated routes and query data preserved/isolated.');
