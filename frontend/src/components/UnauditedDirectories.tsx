import { useState } from 'react';
import useSWR from 'swr';
import { ExternalLink, Check, Copy } from 'lucide-react';
import { fetcher } from '../services/api';

/**
 * Apple Maps and Bing Places are the two directories our citation scan cannot
 * check — and never will, by any search-based method.
 *
 * Their listings are not published as indexable web pages. Verified against the
 * live SERP API: `site:maps.apple.com <business>` returns a single junk result and
 * `site:bing.com/maps <business>` returns nothing. Reading them requires a direct
 * data partnership with Apple and Microsoft, which is what BrightLocal, Yext and
 * Uberall actually sell — BrightLocal's price for it is $500/mo on a 12-month
 * commitment, which we declined (issue #149).
 *
 * So rather than pretend to audit them, we point the customer at the free
 * self-serve portals. That is genuinely more useful: these are listings only the
 * business owner can claim, and neither can be fixed through us at any price.
 *
 * The copy deliberately does NOT read as an outage or a temporary gap — it is a
 * permanent property of those platforms, and saying otherwise would invite the
 * customer to wait for a fix that is not coming.
 */

interface LocationRow {
  id: string;
  name: string;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  phone: string | null;
}

const PORTALS = [
  {
    name: 'Apple Business Connect',
    url: 'https://businessconnect.apple.com',
    why: 'Powers Apple Maps and Siri on every iPhone.',
    note: 'Free. Apple verifies by phone call or postcard.',
  },
  {
    name: 'Bing Places for Business',
    url: 'https://www.bingplaces.com',
    why: 'Feeds Bing and Microsoft Copilot.',
    note: 'Free. Usually verified within a few days.',
  },
];

function formatNap(loc: LocationRow): string {
  const line2 = [loc.city, loc.state].filter(Boolean).join(', ');
  return [loc.name, loc.address, [line2, loc.zip].filter(Boolean).join(' '), loc.phone]
    .filter(Boolean)
    .join('\n');
}

function LocationCard({ loc, onDismiss }: { loc: LocationRow; onDismiss: () => void }) {
  const [copied, setCopied] = useState(false);
  const nap = formatNap(loc);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(nap);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Clipboard can be blocked by permissions — the details are on screen
      // anyway, so this is not worth surfacing as an error.
    }
  };

  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-5 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">
            Two directories you&apos;ll need to claim yourself
          </h3>
          <p className="text-sm text-gray-600 mt-1 max-w-2xl">
            Apple Maps and Bing Places don&apos;t publish their listings publicly, so no tool can
            check them automatically. They&apos;re not part of the scan above and won&apos;t be —
            it&apos;s how those platforms work, not something that&apos;s broken.
          </p>
        </div>
        <button
          onClick={onDismiss}
          aria-label="Dismiss"
          className="text-gray-400 hover:text-gray-600 text-sm shrink-0"
        >
          ✕
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {PORTALS.map((p) => (
          <div key={p.name} className="border border-gray-100 rounded-lg p-3">
            <a
              href={p.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm font-medium text-brand-600 hover:text-brand-700 inline-flex items-center gap-1"
            >
              {p.name}
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
            <p className="text-xs text-gray-600 mt-1">{p.why}</p>
            <p className="text-xs text-gray-400 mt-1">{p.note}</p>
          </div>
        ))}
      </div>

      <div className="bg-gray-50 border border-gray-100 rounded-lg p-3">
        <div className="flex items-center justify-between gap-3 mb-2">
          <p className="text-xs font-medium text-gray-700">
            Use exactly this, for {loc.name}
          </p>
          <button
            onClick={() => void copy()}
            className="text-xs font-medium text-brand-600 hover:text-brand-700 inline-flex items-center gap-1"
          >
            {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
        <pre className="text-xs text-gray-800 whitespace-pre-wrap font-sans leading-relaxed">{nap}</pre>
        <p className="text-xs text-gray-500 mt-2">
          Match this character for character — &ldquo;Ste&rdquo; and &ldquo;Suite&rdquo; count as
          different addresses to a search engine, and inconsistent details are exactly what hurts
          local ranking.
        </p>
      </div>
    </div>
  );
}

export default function UnauditedDirectories() {
  const { data } = useSWR<{ success: boolean; data: LocationRow[] }>('/locations', fetcher);
  const locations = data?.data ?? [];
  const [dismissed, setDismissed] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('unaudited_dirs_dismissed') ?? '[]') as string[];
    } catch {
      return [];
    }
  });

  const dismiss = (id: string) => {
    const next = [...dismissed, id];
    setDismissed(next);
    localStorage.setItem('unaudited_dirs_dismissed', JSON.stringify(next));
  };

  const visible = locations.filter((l) => !dismissed.includes(l.id));
  if (visible.length === 0) return null;

  return (
    <div className="space-y-3">
      {visible.map((loc) => (
        <LocationCard key={loc.id} loc={loc} onDismiss={() => dismiss(loc.id)} />
      ))}
    </div>
  );
}
