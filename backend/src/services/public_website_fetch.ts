import { lookup } from 'dns/promises';
import { isIP } from 'net';
import http from 'http';
import https from 'https';

export function isPublicAddress(address: string): boolean {
  if (isIP(address) === 6) {
    // Global unicast only. Exclude documentation, Teredo, and mapped IPv4 forms.
    return /^[23][0-9a-f]{0,3}:/i.test(address) && !/^2001:(?:db8:|0*:)/i.test(address) && !/^2002:|^3fff:/i.test(address);
  }
  if (isIP(address) !== 4) return false;
  const [a, b, c] = address.split('.').map(Number);
  return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0)) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
    (a === 203 && b === 0 && c === 113));
}

type Hop = { status: number; location?: string; body: string };
type Address = { address: string; family: number };
type Dependencies = {
  resolve: (hostname: string) => Promise<Address[]>;
  request: (url: URL, address: Address, timeout: number) => Promise<Hop>;
};

function requestPinned(url: URL, address: Address, timeout: number): Promise<Hop> {
  return new Promise((resolve, reject) => {
    // Keep the original hostname for Host and TLS verification, pin the validated
    // DNS address for the socket so a second DNS lookup cannot rebind to localhost.
    const req = (url.protocol === 'https:' ? https : http).request(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LocalSEOAuditBot/1.0)', 'Accept-Encoding': 'identity' },
      lookup: ((_hostname: string, options: any, callback: any) => options?.all
        ? callback(null, [address]) : callback(null, address.address, address.family)) as any,
    }, res => {
      const chunks: Buffer[] = [];
      let size = 0;
      res.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > 2 * 1024 * 1024) { req.destroy(new Error('Website response too large')); return; }
        chunks.push(chunk);
      });
      res.on('end', () => { clearTimeout(timer); resolve({ status: res.statusCode ?? 0, location: res.headers.location, body: Buffer.concat(chunks).toString('utf8') }); });
      res.on('error', reject);
    });
    const timer = setTimeout(() => req.destroy(new Error('Website request timed out')), timeout);
    req.on('error', e => { clearTimeout(timer); reject(e); });
    req.end();
  });
}

/** Bounded public HTTP fetch: validate every redirect and pin each validated DNS result. */
export async function fetchPublicWebsite(value: string, deps: Dependencies = {
  resolve: hostname => lookup(hostname, { all: true }), request: requestPinned,
}): Promise<{ ok: boolean; status: number; url: string; text: () => Promise<string> }> {
  const deadline = Date.now() + 6000;
  let url = new URL(value);
  for (let hop = 0; hop <= 5; hop++) {
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
      (url.port && !['80', '443'].includes(url.port))) throw new Error('Only public HTTP websites are supported');
    const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    if (!hostname || hostname === 'localhost' || /\.(localhost|local|internal)$/.test(hostname)) throw new Error('Private website destination');
    let timer: ReturnType<typeof setTimeout> | undefined;
    const addresses = isIP(hostname) ? [{ address: hostname, family: isIP(hostname) }] : await Promise.race([
      deps.resolve(hostname), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Website DNS timed out')), Math.max(1, deadline - Date.now())); }),
    ]).finally(() => { if (timer) clearTimeout(timer); });
    if (!addresses.length || addresses.some(a => !isPublicAddress(a.address))) throw new Error('Private website destination');
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error('Website request timed out');
    const response = await deps.request(url, addresses[0], remaining);
    if ([301, 302, 303, 307, 308].includes(response.status) && response.location) {
      url = new URL(response.location, url); continue;
    }
    return { ok: response.status >= 200 && response.status < 300, status: response.status, url: url.href, text: async () => response.body };
  }
  throw new Error('Too many website redirects');
}
