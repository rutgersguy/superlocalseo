import { useState } from 'react';
import useSWR, { mutate } from 'swr';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { fetcher, apiFetch } from '../services/api';

interface LocationOption { id: string; name: string; blCampaignId?: string | null; }
interface LocationsResponse { success: boolean; data: LocationOption[]; }

interface LighthouseAuditItem {
  title: string;
  description: string;
  displayValue: string | null;
  score: number | null;
}

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
  categoryAudits?: {
    performance: LighthouseAuditItem[];
    accessibility: LighthouseAuditItem[];
    bestPractices: LighthouseAuditItem[];
    seo: LighthouseAuditItem[];
  };
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

const CWV_METRICS = {
  lcp: {
    label: 'Page Load Speed',
    subtitle: 'Time until the main content is visible',
    tooltip: 'Largest Contentful Paint (LCP) measures how long it takes for the largest element on your page — usually a hero image or heading — to fully appear. Google uses this as a Core Web Vital ranking signal. Under 2.5s is Good.',
    format: (v: number) => `${(v / 1000).toFixed(2)}s`,
    good: (v: number) => v <= 2500,
    ok: (v: number) => v <= 4000,
  },
  cls: {
    label: 'Layout Stability',
    subtitle: 'How much your page shifts while loading',
    tooltip: 'Cumulative Layout Shift (CLS) measures how much elements jump around as the page loads — e.g. a button that moves right before you click it. A high CLS creates a frustrating experience and hurts rankings. Under 0.1 is Good.',
    format: (v: number) => v.toFixed(3),
    good: (v: number) => v <= 0.1,
    ok: (v: number) => v <= 0.25,
  },
  tbt: {
    label: 'Interactivity',
    subtitle: 'How quickly your page responds to clicks',
    tooltip: 'Total Blocking Time (TBT) measures how long the browser is "frozen" and unable to respond to user input while JavaScript loads. A high TBT makes your site feel sluggish. Under 200ms is Good.',
    format: (v: number) => `${Math.round(v)}ms`,
    good: (v: number) => v <= 200,
    ok: (v: number) => v <= 600,
  },
} as const;

type CwvKey = keyof typeof CWV_METRICS;

function cwvColor(metric: CwvKey, value: number): string {
  const m = CWV_METRICS[metric];
  return m.good(value) ? 'text-green-600' : m.ok(value) ? 'text-yellow-600' : 'text-red-500';
}

function cwvStatusLabel(metric: CwvKey, value: number): string {
  const m = CWV_METRICS[metric];
  return m.good(value) ? 'Good' : m.ok(value) ? 'Needs Work' : 'Poor';
}

const LH_CATEGORIES = [
  {
    key: 'performanceScore' as const,
    auditsKey: 'performance' as const,
    label: 'Overall Performance',
    description: 'How fast your page loads and feels to visitors. Google uses performance as a ranking signal — slow pages rank lower and lose more than half their visitors before the page even loads.',
    howToImprove: 'Work with your web developer to compress images, reduce JavaScript, and enable browser caching. Many of the specific issues below have estimated time savings — focus on the highest-impact ones first.',
  },
  {
    key: 'accessibilityScore' as const,
    auditsKey: 'accessibility' as const,
    label: 'Accessibility',
    description: 'How usable your site is for people with disabilities — including those using screen readers, keyboard navigation, or requiring high colour contrast. Google treats accessibility as a quality signal.',
    howToImprove: 'Add alt text to images, ensure buttons have descriptive labels, and verify that text colours meet contrast requirements. Most website builders and SEO plugins highlight these issues automatically.',
  },
  {
    key: 'bestPracticesScore' as const,
    auditsKey: 'bestPractices' as const,
    label: 'Best Practices',
    description: 'Whether your site follows modern web security and quality standards — HTTPS, no browser console errors, correctly sized images, and up-to-date software. Issues here can affect user trust and search indexing.',
    howToImprove: 'Ensure your site loads over HTTPS, fix any JavaScript errors, and update plugins and themes. Ask your developer to review the items flagged below.',
  },
  {
    key: 'seoScore' as const,
    auditsKey: 'seo' as const,
    label: 'Technical SEO',
    description: 'Technical signals that affect how well search engines can find, crawl, and understand your pages — including mobile-friendliness, crawlability, meta tags, and structured data. These work alongside the on-page checks above.',
    howToImprove: 'Ensure your site has a robots.txt, a sitemap, and that all pages are mobile-friendly. Fix any meta tag or structured data issues flagged below.',
  },
] as const;

function lhBarColor(score: number): string {
  return score >= 75 ? 'bg-green-500' : score >= 50 ? 'bg-yellow-500' : 'bg-red-500';
}

function lhTextColor(score: number): string {
  return score >= 75 ? 'text-green-600' : score >= 50 ? 'text-yellow-600' : 'text-red-500';
}

function auditDotColor(score: number | null): string {
  if (score == null) return 'bg-gray-300';
  if (score >= 0.9) return 'bg-green-500';
  if (score >= 0.5) return 'bg-yellow-400';
  return 'bg-red-500';
}

function LighthouseCategory({
  label, description, howToImprove, score, audits,
}: {
  label: string;
  description: string;
  howToImprove: string;
  score: number;
  audits: LighthouseAuditItem[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border border-gray-100 rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 text-left"
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-sm font-medium text-gray-800">{label}</span>
            <span className={`text-sm font-bold ml-2 ${lhTextColor(score)}`}>{score}</span>
          </div>
          <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
            <div className={`h-full ${lhBarColor(score)} rounded-full`} style={{ width: `${score}%` }} />
          </div>
        </div>
        <span className="flex-shrink-0 text-gray-400 ml-2">
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </span>
      </button>
      {open && (
        <div className="border-t border-gray-100 px-4 py-4 bg-gray-50 space-y-4">
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">What this measures</p>
            <p className="text-xs text-gray-700 leading-relaxed">{description}</p>
          </div>
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">How to improve it</p>
            <p className="text-xs text-gray-700 leading-relaxed">{howToImprove}</p>
          </div>
          {audits.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Issues found</p>
              <ul className="space-y-2">
                {audits.map((a, i) => (
                  <AuditIssueItem key={i} item={a} />
                ))}
              </ul>
            </div>
          )}
          {audits.length === 0 && (
            <p className="text-xs text-green-700 bg-green-50 border border-green-100 rounded px-3 py-2">No significant issues found in this category.</p>
          )}
        </div>
      )}
    </div>
  );
}

function AuditIssueItem({ item }: { item: LighthouseAuditItem }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="bg-white border border-gray-100 rounded-md overflow-hidden">
      <button
        type="button"
        onClick={() => item.description ? setOpen((o) => !o) : undefined}
        className={`w-full flex items-start gap-2 px-3 py-2 text-left ${item.description ? 'hover:bg-gray-50 cursor-pointer' : 'cursor-default'}`}
      >
        <span className={`mt-1.5 flex-shrink-0 w-2 h-2 rounded-full ${auditDotColor(item.score)}`} />
        <span className="flex-1 text-xs text-gray-700">{item.title}</span>
        {item.displayValue && (
          <span className="flex-shrink-0 text-xs text-gray-400 ml-2 whitespace-nowrap">{item.displayValue}</span>
        )}
        {item.description && (
          <span className="flex-shrink-0 text-gray-300 mt-0.5">
            {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </span>
        )}
      </button>
      {open && item.description && (
        <div className="border-t border-gray-100 px-3 py-2 bg-blue-50">
          <p className="text-xs text-gray-600 leading-relaxed">{item.description}</p>
        </div>
      )}
    </li>
  );
}

function CwvCard({ metricKey, value }: { metricKey: CwvKey; value: number }) {
  const m = CWV_METRICS[metricKey];
  const color = cwvColor(metricKey, value);
  const status = cwvStatusLabel(metricKey, value);
  return (
    <div className="relative group bg-gray-50 rounded-lg p-4 border border-gray-100">
      <p className="text-xs font-semibold text-gray-700">{m.label}</p>
      <p className="text-xs text-gray-400 mt-0.5 mb-2">{m.subtitle}</p>
      <p className={`text-2xl font-bold ${color}`}>{m.format(value)}</p>
      <p className={`text-xs font-semibold mt-0.5 ${color}`}>{status}</p>
      <div className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-60 rounded-lg bg-gray-900 px-3 py-2 text-xs text-gray-100 opacity-0 group-hover:opacity-100 transition-opacity z-10 text-left shadow-lg">
        {m.tooltip}
        <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-900" />
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

      {/* Performance & Core Web Vitals */}
      {latestAudit && (latestAudit.dfsOnPageData || latestAudit.dfsLighthouseTaskId) && (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-base font-semibold text-gray-900">Website Performance</h2>
              <p className="text-xs text-gray-400 mt-0.5">Measured by Google Lighthouse — hover any metric for details</p>
            </div>
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
                <div className="grid grid-cols-3 gap-3">
                  {lh.lcp != null && <CwvCard metricKey="lcp" value={lh.lcp} />}
                  {lh.cls != null && <CwvCard metricKey="cls" value={lh.cls} />}
                  {lh.tbt != null && <CwvCard metricKey="tbt" value={lh.tbt} />}
                </div>
                <div className="space-y-2">
                  {LH_CATEGORIES.map((cat) => (
                    <LighthouseCategory
                      key={cat.key}
                      label={cat.label}
                      description={cat.description}
                      howToImprove={cat.howToImprove}
                      score={lh[cat.key]}
                      audits={lh.categoryAudits?.[cat.auditsKey] ?? []}
                    />
                  ))}
                </div>
              </div>
            );
          })()}
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
