import { useState } from 'react';
import useSWR, { mutate } from 'swr';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { fetcher, apiFetch } from '../services/api';

interface LocationOption { id: string; name: string; blCampaignId?: string | null; }
interface LocationsResponse { success: boolean; data: LocationOption[]; }

interface LighthouseData {
  performanceScore: number;
  accessibilityScore: number;
  bestPracticesScore: number;
  seoScore: number;
  lcp: number | null;
  cls: number | null;
  tbt: number | null;
  fcp: number | null;
  speedIndex: number | null;
  fetchedAt: string;
}

interface AuditRow {
  id: string;
  locationId: string;
  status: string;
  napScore: number | null;
  citationScore: number | null;
  reviewScore: number | null;
  googleScore: number | null;
  compositeScore: number | null;
  onPageScore: number | null;
  onPageDetails: string[];
  dfsLighthouseTaskId: string | null;
  dfsOnPageData: LighthouseData | null;
  recommendations: string[];
  completedAt: string | null;
  createdAt: string;
}
interface AuditsResponse { success: boolean; data: { audits: AuditRow[] }; }
interface HistoryResponse { success: boolean; data: { audits: AuditRow[] }; }

function ScoreCard({ label, value, delta, tooltip }: { label: string; value: number | null; delta: number | null; tooltip: string }) {
  const color = value == null ? 'text-gray-400'
    : value >= 80 ? 'text-green-600'
    : value >= 60 ? 'text-yellow-600'
    : 'text-red-500';
  return (
    <div className="relative group bg-white rounded-xl border border-gray-100 shadow-sm p-4 text-center">
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <p className={`text-2xl font-bold ${color}`}>{value != null ? value.toFixed(0) : '—'}</p>
      <div className="flex items-center justify-center gap-1 mt-0.5">
        <p className="text-xs text-gray-400">/ 100</p>
        {delta !== null && delta !== 0 && (
          <span className={`text-xs font-semibold ${delta > 0 ? 'text-emerald-600' : 'text-red-500'}`}>
            {delta > 0 ? '▲' : '▼'} {Math.abs(delta)}
          </span>
        )}
        {delta === 0 && <span className="text-xs text-gray-300">—</span>}
      </div>
      <div className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-52 rounded-lg bg-gray-900 px-3 py-2 text-xs text-gray-100 opacity-0 group-hover:opacity-100 transition-opacity z-10 text-left shadow-lg">
        {tooltip}
        <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-900" />
      </div>
    </div>
  );
}

// ─── On-page tip definitions ──────────────────────────────────────────────────

interface Tip { what: string; howToFix: string; }

function getTip(detail: string): Tip | null {
  const d = detail.toLowerCase();
  if (d.includes('https')) {
    return {
      what: 'HTTPS encrypts traffic between your visitor and your website. Google has used HTTPS as a ranking signal since 2014, and browsers now show a "Not Secure" warning on HTTP sites — which kills trust immediately.',
      howToFix: d.includes('not using')
        ? 'Contact your web host or domain registrar and enable an SSL/TLS certificate (free via Let\'s Encrypt on most hosts). Then redirect all HTTP traffic to HTTPS with a 301 redirect in your .htaccess or server config.'
        : 'Your site is already on HTTPS — no action needed.',
    };
  }
  if (d.includes('title tag') || d.includes('<title>')) {
    const isGood = d.includes('optimal');
    return {
      what: 'The <title> tag is the blue clickable headline shown in Google search results. It\'s one of the strongest on-page signals — Google uses it to understand what your page is about. It also affects click-through rate: a clear, descriptive title gets more clicks.',
      howToFix: isGood
        ? 'Your title is the right length — make sure it includes your primary service and city (e.g. "HVAC Repair in Tulsa, OK | Aire Serv").'
        : d.includes('short')
          ? 'Add your primary keyword and city to the title. Aim for 50–60 characters. Example: "Heating & AC Repair Tulsa OK | Aire Serv of South Tulsa".'
          : 'Trim the title to under 60 characters so it doesn\'t get cut off in search results. Focus on the most important keyword + city + brand.',
    };
  }
  if (d.includes('meta description')) {
    const isGood = d.includes('optimal');
    return {
      what: 'The meta description is the grey snippet of text shown beneath your title in search results. Google doesn\'t use it as a direct ranking factor, but a compelling description increases click-through rate — which indirectly helps your rankings.',
      howToFix: isGood
        ? 'Your description length is good. Make sure it includes a clear call to action and your primary keyword + city.'
        : d.includes('short')
          ? 'Expand your meta description to 120–160 characters. Describe what you do, mention your city, and add a call to action like "Call us for same-day service."'
          : 'Trim the description to 155 characters. Anything longer gets cut off with "..." in search results.',
    };
  }
  if (d.includes('h1')) {
    const isGood = d.includes('good');
    return {
      what: 'The H1 is the main visible heading on your webpage. Search engines treat it as the primary topic signal for the page — it should clearly state what the page is about. Every page should have exactly one H1.',
      howToFix: isGood
        ? 'Your page has exactly 1 H1 — good. Make sure it includes your primary service and city (e.g. "HVAC & AC Repair Services in South Tulsa, OK").'
        : d.includes('no ')
          ? 'Add a single H1 tag to your homepage. In most website builders (WordPress, Squarespace, Wix), the main page headline is automatically set as the H1. Make it descriptive: "[Service] in [City, State]".'
          : 'You have multiple H1 tags — reduce to one. Additional headings should use H2 and H3 instead.',
    };
  }
  if (d.includes('schema') || d.includes('json-ld') || d.includes('structured data')) {
    const isGood = d.includes('detected');
    return {
      what: 'Schema markup (specifically LocalBusiness JSON-LD) is structured data you embed in your page that tells Google exactly what type of business you are, your address, phone number, hours, and service area. It can unlock rich results in search (star ratings, hours, address) and is a proven local SEO signal.',
      howToFix: isGood
        ? 'LocalBusiness schema is detected — great. Make sure it includes your name, address, phone (NAP), opening hours, and geographic area served.'
        : 'Add a LocalBusiness JSON-LD script to your site\'s <head>. Use Google\'s Structured Data Markup Helper (search "Google structured data markup helper") to generate the code, then paste it into your site. In WordPress, the Rank Math or Yoast SEO plugin handles this automatically.',
    };
  }
  if (d.includes('canonical')) {
    const isGood = d.includes('present');
    return {
      what: 'A canonical tag tells Google which version of a page is the "official" one. Without it, Google may index duplicate versions of your page (e.g. http vs https, with/without trailing slash) and split ranking signals between them — hurting your position.',
      howToFix: isGood
        ? 'Canonical tag is present — no action needed. Verify it points to the correct HTTPS URL of the page.'
        : 'Add <link rel="canonical" href="https://yoursite.com/page/"> to your page\'s <head>. Most SEO plugins (Yoast, Rank Math) add this automatically. If you\'re on Squarespace or Shopify, canonical tags are added by default.',
    };
  }
  if (d.includes('viewport') || d.includes('mobile')) {
    const isGood = d.includes('present');
    return {
      what: 'The viewport meta tag tells mobile browsers how to scale your page. Without it, your site renders at desktop width on phones — making text tiny and unusable. Google primarily uses the mobile version of your site to determine rankings (mobile-first indexing), so this is critical.',
      howToFix: isGood
        ? 'Viewport tag is present — your site signals mobile responsiveness. Test the actual experience at google.com/webmasters/tools/mobile-friendly.'
        : 'Add this line inside your page\'s <head>: <meta name="viewport" content="width=device-width, initial-scale=1">. In site builders like WordPress or Squarespace, any modern theme includes this automatically.',
    };
  }
  if (d.includes('could not fetch') || d.includes('http ') || d.includes('accessible')) {
    return {
      what: 'The audit tool couldn\'t load your website — either the URL in your location settings is wrong, the site returned an error, or it blocked our crawler.',
      howToFix: 'Check that the website URL in your location settings is correct and publicly accessible. Open it in a private/incognito browser to verify. If your site blocks bots, whitelist the user agent "LocalSEOAuditBot".',
    };
  }
  return null;
}

function OnPageItem({ detail }: { detail: string }) {
  const [open, setOpen] = useState(false);
  const isIssue = /not using|no |missing|too |add |migrate|couldn't|check that|multiple|short|long/i.test(detail);
  const tip = getTip(detail);

  return (
    <li className="border border-gray-100 rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => tip && setOpen((o) => !o)}
        className={`w-full flex items-start gap-2 px-4 py-3 text-left text-sm text-gray-700 ${tip ? 'hover:bg-gray-50 cursor-pointer' : 'cursor-default'}`}
      >
        <span className={`mt-0.5 flex-shrink-0 font-bold ${isIssue ? 'text-red-500' : 'text-emerald-500'}`}>
          {isIssue ? '✗' : '✓'}
        </span>
        <span className="flex-1">{detail}</span>
        {tip && (
          <span className="flex-shrink-0 text-gray-400 mt-0.5">
            {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </span>
        )}
      </button>
      {open && tip && (
        <div className="border-t border-gray-100 px-4 py-3 bg-gray-50 space-y-2">
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">What this means</p>
            <p className="text-xs text-gray-700 leading-relaxed">{tip.what}</p>
          </div>
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">How to fix it</p>
            <p className="text-xs text-gray-700 leading-relaxed">{tip.howToFix}</p>
          </div>
        </div>
      )}
    </li>
  );
}

// ─── CWV helpers ─────────────────────────────────────────────────────────────

function cwvColor(metric: 'lcp' | 'cls' | 'tbt', value: number): string {
  if (metric === 'lcp') return value <= 2500 ? 'text-green-600' : value <= 4000 ? 'text-yellow-600' : 'text-red-500';
  if (metric === 'cls') return value <= 0.1 ? 'text-green-600' : value <= 0.25 ? 'text-yellow-600' : 'text-red-500';
  return value <= 200 ? 'text-green-600' : value <= 600 ? 'text-yellow-600' : 'text-red-500';
}

function cwvLabel(metric: 'lcp' | 'cls' | 'tbt', value: number): string {
  if (metric === 'lcp') return value <= 2500 ? 'Good' : value <= 4000 ? 'Needs Work' : 'Poor';
  if (metric === 'cls') return value <= 0.1 ? 'Good' : value <= 0.25 ? 'Needs Work' : 'Poor';
  return value <= 200 ? 'Good' : value <= 600 ? 'Needs Work' : 'Poor';
}

function lhScoreColor(score: number): string {
  return score >= 75 ? 'bg-green-500' : score >= 50 ? 'bg-yellow-500' : 'bg-red-500';
}

function LighthouseBar({ label, score }: { label: string; score: number }) {
  const color = lhScoreColor(score);
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-gray-600">{label}</span>
        <span className="text-xs font-semibold text-gray-700">{score}</span>
      </div>
      <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full`} style={{ width: `${score}%` }} />
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function AuditHistory() {
  const [selectedLocationId, setSelectedLocationId] = useState('');
  const [triggering, setTriggering] = useState(false);
  const [triggerError, setTriggerError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  const { data: locData } = useSWR<LocationsResponse>('/locations', fetcher);
  const locations = locData?.data ?? [];

  const { data: auditsData, isLoading } = useSWR<AuditsResponse>('/audits/bl', fetcher);
  const allAudits = auditsData?.data?.audits ?? [];

  const effectiveLocationId = selectedLocationId || locations[0]?.id || '';

  const { data: historyData } = useSWR<HistoryResponse>(
    effectiveLocationId ? `/audits/bl/location/${effectiveLocationId}/history` : null,
    fetcher,
  );
  const historyAudits = historyData?.data?.audits ?? [];

  const latestAudit = allAudits.find((a) => a.locationId === effectiveLocationId && a.status === 'complete');
  const completeHistory = historyAudits.filter((a) => a.status === 'complete');
  const previousAudit = completeHistory.length >= 2 ? completeHistory[completeHistory.length - 2] : null;
  const delta = (key: keyof AuditRow) => {
    if (!latestAudit || !previousAudit) return null;
    const curr = latestAudit[key] as number | null;
    const prev = previousAudit[key] as number | null;
    if (curr == null || prev == null) return null;
    return Math.round(curr - prev);
  };
  const recentAuditDaysAgo = (() => {
    const recent = allAudits.find((a) => a.locationId === effectiveLocationId);
    if (!recent) return null;
    return Math.floor((Date.now() - new Date(recent.createdAt).getTime()) / (1000 * 60 * 60 * 24));
  })();

  const canTrigger = recentAuditDaysAgo === null || recentAuditDaysAgo >= 1;

  const chartData = Object.values(
    historyAudits
      .filter((a) => a.status === 'complete' && a.completedAt)
      .reduce<Record<string, { date: string; NAP: number | null; Citations: number | null; Reviews: number | null; Google: number | null; Overall: number | null }>>((acc, a) => {
        const day = new Date(a.completedAt!).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        acc[day] = { date: day, NAP: a.napScore, Citations: a.citationScore, Reviews: a.reviewScore, Google: a.googleScore, Overall: a.compositeScore };
        return acc;
      }, {}),
  );

  const handleDownload = async () => {
    if (!latestAudit) return;
    setDownloading(true);
    try {
      const res = await apiFetch<Response>(`/audits/bl/${latestAudit.id}/report`, {}, true);
      if (!res.ok) throw new Error('Download failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'seo-audit-report.pdf';
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      // silently fail
    } finally {
      setDownloading(false);
    }
  };

  const handleTrigger = async () => {
    if (!effectiveLocationId) return;
    setTriggering(true);
    setTriggerError(null);
    try {
      await apiFetch('/audits/bl/generate', {
        method: 'POST',
        body: JSON.stringify({ locationId: effectiveLocationId }),
      });
      await Promise.all([
        mutate('/audits/bl'),
        mutate(`/audits/bl/location/${effectiveLocationId}/history`),
      ]);
    } catch (e) {
      setTriggerError((e as Error).message ?? 'Failed to trigger audit');
    } finally {
      setTriggering(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-gray-900">Local SEO Audit</h1>
          <div className="flex items-center gap-3">
          {locations.length > 1 && (
            <select value={effectiveLocationId} onChange={(e) => setSelectedLocationId(e.target.value)}
              className="text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500">
              {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          )}
          {latestAudit && (
            <button
              onClick={() => void handleDownload()}
              disabled={downloading}
              className="whitespace-nowrap px-1.5 py-1 text-xs sm:px-4 sm:py-2 sm:text-sm font-medium border border-gray-200 text-gray-600 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {downloading ? 'Generating…' : 'Download Report'}
            </button>
          )}
          <button
            onClick={() => void handleTrigger()}
            disabled={triggering || !canTrigger}
            title={!canTrigger ? 'Your audit runs automatically every day. You can also run one manually again tomorrow.' : ''}
            className="whitespace-nowrap px-1.5 py-1 text-xs sm:px-4 sm:py-2 sm:text-sm font-medium bg-brand-600 text-white rounded-lg hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {triggering ? 'Starting…' : 'Run Audit'}
          </button>
          </div>
        </div>
        <p className="text-sm text-gray-500 mt-1">Monthly health scores across NAP, citations, reviews, and Google presence</p>
      </div>

      {triggerError && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{triggerError}</div>
      )}

      {/* Score cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
        <ScoreCard label="Overall" value={latestAudit?.compositeScore ?? null} delta={delta('compositeScore')} tooltip="Weighted average: Citations 40%, NAP consistency 30%, Keyword rankings 30%." />
        <ScoreCard label="NAP" value={latestAudit?.napScore ?? null} delta={delta('napScore')} tooltip="Percentage of directory listings where your business name, address, and phone number all match exactly. Only counts directories where field-level detail data is available." />
        <ScoreCard label="Citations" value={latestAudit?.citationScore ?? null} delta={delta('citationScore')} tooltip="Percentage of key directories for your industry where your business is listed." />
        <ScoreCard label="Reviews" value={latestAudit?.reviewScore ?? null} delta={delta('reviewScore')} tooltip="Average rating and review volume score. Requires Google Business Profile connection." />
        <ScoreCard label="Google" value={latestAudit?.googleScore ?? null} delta={delta('googleScore')} tooltip="Google Business Profile completeness — claimed status, photos, hours, and posts. Requires GBP connection." />
        <ScoreCard label="On-Page" value={latestAudit?.onPageScore ?? null} delta={delta('onPageScore')} tooltip="Website on-page SEO score: title tag, meta description, H1, LocalBusiness schema, canonical URL, HTTPS, and mobile viewport." />
      </div>

      {/* Recommendations */}
      {latestAudit && latestAudit.recommendations && latestAudit.recommendations.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
          <h2 className="text-base font-semibold text-gray-900 mb-3">Recommendations</h2>
          <ul className="space-y-2">
            {latestAudit.recommendations.map((rec, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
                <span className="mt-0.5 text-amber-500 flex-shrink-0">●</span>
                {rec}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* On-Page SEO detail */}
      {latestAudit?.onPageDetails && latestAudit.onPageDetails.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-base font-semibold text-gray-900">On-Page SEO Checks</h2>
            <span className="text-xs text-gray-400">Click any item to learn more</span>
          </div>
          <ul className="space-y-1.5">
            {latestAudit.onPageDetails.map((detail, i) => (
              <OnPageItem key={i} detail={detail} />
            ))}
          </ul>
        </div>
      )}

      {/* Performance & Core Web Vitals */}
      {latestAudit && (latestAudit.dfsOnPageData || latestAudit.dfsLighthouseTaskId) && (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold text-gray-900">Performance &amp; Core Web Vitals</h2>
            {latestAudit.dfsLighthouseTaskId && !latestAudit.dfsOnPageData && (
              <span className="text-xs text-amber-600 bg-amber-50 border border-amber-200 px-2.5 py-1 rounded-full">
                Fetching performance data…
              </span>
            )}
          </div>
          {latestAudit.dfsOnPageData && (() => {
            const lh = latestAudit.dfsOnPageData!;
            return (
              <div className="space-y-5">
                {/* CWV badges */}
                <div className="grid grid-cols-3 gap-3">
                  {lh.lcp != null && (
                    <div className="bg-gray-50 rounded-lg p-3 text-center border border-gray-100">
                      <p className="text-xs text-gray-500 font-medium mb-1">LCP</p>
                      <p className={`text-xl font-bold ${cwvColor('lcp', lh.lcp)}`}>{(lh.lcp / 1000).toFixed(2)}s</p>
                      <p className={`text-xs font-semibold mt-0.5 ${cwvColor('lcp', lh.lcp)}`}>{cwvLabel('lcp', lh.lcp)}</p>
                    </div>
                  )}
                  {lh.cls != null && (
                    <div className="bg-gray-50 rounded-lg p-3 text-center border border-gray-100">
                      <p className="text-xs text-gray-500 font-medium mb-1">CLS</p>
                      <p className={`text-xl font-bold ${cwvColor('cls', lh.cls)}`}>{lh.cls.toFixed(3)}</p>
                      <p className={`text-xs font-semibold mt-0.5 ${cwvColor('cls', lh.cls)}`}>{cwvLabel('cls', lh.cls)}</p>
                    </div>
                  )}
                  {lh.tbt != null && (
                    <div className="bg-gray-50 rounded-lg p-3 text-center border border-gray-100">
                      <p className="text-xs text-gray-500 font-medium mb-1">TBT</p>
                      <p className={`text-xl font-bold ${cwvColor('tbt', lh.tbt)}`}>{Math.round(lh.tbt)}ms</p>
                      <p className={`text-xs font-semibold mt-0.5 ${cwvColor('tbt', lh.tbt)}`}>{cwvLabel('tbt', lh.tbt)}</p>
                    </div>
                  )}
                </div>
                {/* Lighthouse score bars */}
                <div className="grid grid-cols-2 gap-x-6 gap-y-3">
                  <LighthouseBar label="Performance" score={lh.performanceScore} />
                  <LighthouseBar label="Accessibility" score={lh.accessibilityScore} />
                  <LighthouseBar label="Best Practices" score={lh.bestPracticesScore} />
                  <LighthouseBar label="SEO" score={lh.seoScore} />
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {/* History chart */}
      {chartData.length > 1 && (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
          <h2 className="text-base font-semibold text-gray-900 mb-4">Score History</h2>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="Overall" stroke="#6366f1" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="NAP" stroke="#10b981" strokeWidth={1.5} dot={false} />
                <Line type="monotone" dataKey="Citations" stroke="#f59e0b" strokeWidth={1.5} dot={false} />
                <Line type="monotone" dataKey="Reviews" stroke="#3b82f6" strokeWidth={1.5} dot={false} />
                <Line type="monotone" dataKey="Google" stroke="#ef4444" strokeWidth={1.5} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {!isLoading && allAudits.length === 0 && (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-12 text-center">
          <p className="text-gray-400 text-sm">No audit data yet. Run your first audit to see your Local SEO score.</p>
        </div>
      )}
    </div>
  );
}
