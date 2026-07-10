import { useState, useRef, useEffect, type ChangeEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import useSWR, { mutate as swrMutate } from 'swr';
import { QrCode, Download, Trash2, Plus, AlertCircle, CheckCircle2, ExternalLink, ChevronDown, ChevronUp, Copy, Check } from 'lucide-react';
import { apiFetch, fetcher } from '../services/api';
import { useAuth } from '../hooks/useAuth';
import { useClient } from '../hooks/useClient';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ClientData {
  email: string;
  businessName: string;
  industry: string;
  integrations: {
    google: { connected: boolean };
    facebook: { connected: boolean; pageName: string | null };
  };
  billing: {
    plan: string;
    status: string;
  };
}

interface ClientResponse {
  success: boolean;
  data: ClientData;
}

const INDUSTRY_GROUPS: Array<{ group: string; options: string[] }> = [
  { group: 'Home Services', options: ['Plumbing', 'HVAC', 'Electrical', 'Roofing', 'Landscaping', 'Cleaning', 'Pest Control', 'Painting', 'Flooring', 'Moving', 'General Contractor'] },
  { group: 'Health & Fitness', options: ['Personal Training', 'Gym / Fitness Studio', 'Physical Therapy', 'Chiropractic', 'Massage Therapy', 'Dental'] },
  { group: 'Legal', options: ['Law Firm', 'Family Law', 'Personal Injury'] },
  { group: 'Food & Beverage', options: ['Restaurant', 'Coffee Shop', 'Food Truck', 'Bakery'] },
  { group: 'Beauty & Personal Care', options: ['Hair Salon', 'Barbershop', 'Nail Salon', 'Med Spa'] },
  { group: 'Automotive', options: ['Auto Repair', 'Auto Detailing'] },
  { group: 'Professional Services', options: ['Accounting / CPA', 'Real Estate', 'Insurance', 'Veterinary', 'Photography', 'Tutoring'] },
  { group: 'Other', options: ['Other'] },
];
type Tab = 'account' | 'locations' | 'keywords' | 'integrations' | 'billing' | 'team' | 'widgets' | 'qrcodes';

// ─── Team types ───────────────────────────────────────────────────────────────

interface TeamOwner {
  userId: string;
  email: string;
  role: 'owner';
}

interface TeamMember {
  id: string;
  email: string;
  role: string;
  userId: string | null;
  accepted: boolean;
  pending: boolean;
  expired: boolean;
}

interface TeamData {
  owner: TeamOwner | null;
  members: TeamMember[];
}

// ─── Tabs ─────────────────────────────────────────────────────────────────────

function TabBar({ active, onChange, isOwner }: { active: Tab; onChange: (t: Tab) => void; isOwner: boolean }) {
  const { isLite } = useClient();
  // Team and QR Codes are Pro-only (backend gates /team and /qr).
  const tabs: { key: Tab; label: string }[] = [
    { key: 'account', label: 'Account' },
    { key: 'locations', label: 'Locations' },
    { key: 'keywords', label: 'Keywords' },
    { key: 'integrations', label: 'Integrations' },
    { key: 'billing', label: 'Billing' },
    ...(isOwner && !isLite ? [{ key: 'team' as Tab, label: 'Team' }] : []),
    { key: 'widgets' as Tab, label: 'Widgets' },
    ...(isLite ? [] : [{ key: 'qrcodes' as Tab, label: 'QR Codes' }]),
  ];
  return (
    <>
      {/* Mobile: dropdown */}
      <div className="sm:hidden mb-4">
        <select
          value={active}
          onChange={(e) => onChange(e.target.value as Tab)}
          className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-500"
        >
          {tabs.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
        </select>
      </div>

      {/* Desktop: equal-width tab strip */}
      <div className="hidden sm:flex border-b border-slate-200 mb-6">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => onChange(t.key)}
            className={`flex-1 py-2.5 text-xs font-medium text-center transition-colors border-b-2 -mb-px ${
              active === t.key
                ? 'border-brand-500 text-brand-500'
                : 'border-transparent text-slate-500 hover:text-slate-900'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
    </>
  );
}

// ─── OAuth card ────────────────────────────────────────────────────────────────

interface OAuthCardProps {
  name: string;
  description: string;
  connected: boolean;
  comingSoon?: boolean;
  onConnect: () => Promise<void>;
  onDisconnect: () => Promise<void>;
}

function OAuthCard({ name, description, connected, comingSoon, onConnect, onDisconnect }: OAuthCardProps) {
  const [loading, setLoading] = useState(false);

  const handleConnect = async () => {
    setLoading(true);
    try { await onConnect(); } finally { setLoading(false); }
  };

  const handleDisconnect = async () => {
    setLoading(true);
    try { await onDisconnect(); } finally { setLoading(false); }
  };

  return (
    <div className="border border-slate-200 rounded-xl p-5">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">{name}</h3>
          <p className="text-xs text-slate-500 mt-0.5">{description}</p>
        </div>
        {comingSoon ? (
          <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-slate-100 text-slate-400">Coming soon</span>
        ) : (
          <span
            className={`text-xs font-medium px-2 py-0.5 rounded-full ${
              connected ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'
            }`}
          >
            {connected ? 'Connected' : 'Not connected'}
          </span>
        )}
      </div>
      {!comingSoon && (
        <div className="mt-4">
          {connected ? (
            <button
              onClick={() => void handleDisconnect()}
              disabled={loading}
              className="px-4 py-2 text-sm font-medium text-red-600 border border-red-200 rounded-lg hover:bg-red-50 disabled:opacity-50"
            >
              {loading ? 'Disconnecting...' : 'Disconnect'}
            </button>
          ) : (
            <button
              onClick={() => void handleConnect()}
              disabled={loading}
              className="px-4 py-2 text-sm font-medium bg-brand-500 text-white rounded-lg hover:bg-brand-600 disabled:opacity-50"
            >
              {loading ? 'Redirecting...' : `Connect ${name}`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ─── EMR Credentials card ─────────────────────────────────────────────────────

interface EMRCreds {
  ready: boolean;
  loginUrl: string;
  email: string | null;
  password: string | null;
}

function EMRCredentialsCard() {
  const { data, isLoading } = useSWR<{ success: boolean; data: EMRCreds }>('/clients/emr-credentials', fetcher);
  const creds = data?.data;
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const copy = async (value: string, field: string) => {
    await navigator.clipboard.writeText(value);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  };

  const fields = creds?.ready
    ? [
        { label: 'Login URL', value: creds.loginUrl, field: 'url' },
        { label: 'Email', value: creds.email!, field: 'email' },
        { label: 'Password', value: creds.password!, field: 'password' },
      ]
    : [];

  return (
    <div className="border border-slate-200 rounded-xl p-5">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Review Management</h3>
          <p className="text-xs text-slate-500 mt-0.5">Login credentials for your review management portal</p>
        </div>
        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
          isLoading ? 'bg-slate-100 text-slate-400'
          : creds?.ready ? 'bg-green-100 text-green-700'
          : 'bg-amber-100 text-amber-600'
        }`}>
          {isLoading ? '…' : creds?.ready ? 'Active' : 'Setting up'}
        </span>
      </div>

      {!isLoading && !creds?.ready && (
        <p className="text-sm text-slate-500 mb-4">Your review management account is being set up. Check back in a moment.</p>
      )}

      {creds?.ready && (
        <div className="space-y-3 bg-slate-50 rounded-lg p-4 mb-4">
          {fields.map(({ label, value, field }) => (
            <div key={field}>
              <p className="text-xs font-medium text-slate-500 mb-1">{label}</p>
              <div className="flex items-center gap-1.5">
                <span className="text-sm text-slate-800 font-mono break-all">{value}</span>
                <button
                  onClick={() => void copy(value, field)}
                  className="flex-shrink-0 text-slate-400 hover:text-slate-700 transition-colors"
                  title="Copy"
                >
                  {copiedField === field
                    ? <Check className="w-3.5 h-3.5 text-green-600" />
                    : <Copy className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <a
        href="https://app.superlocalseo.com/login"
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 px-4 py-2 bg-brand-500 text-white text-sm font-semibold rounded-lg hover:bg-brand-600 transition-colors"
      >
        Open Review Management <ExternalLink className="w-3.5 h-3.5" />
      </a>
    </div>
  );
}

// ─── Widgets tab ──────────────────────────────────────────────────────────────

interface WidgetConfig {
  theme: 'light' | 'dark';
  minRating: number;
  maxCount: number;
  showPlatformBadge: boolean;
}

interface WidgetAdvancedConfig {
  minRating?: number;
  platforms?: string[];
  keywordFilter?: string;
  sortBy?: 'newest' | 'highest' | 'lowest';
  reviewCount?: number;
  customCss?: string;
}

interface WidgetData {
  id: string;
  widgetKey: string;
  config: WidgetConfig;
}

interface WidgetReview {
  authorName: string;
  rating: number;
  body: string;
  platform: string;
  reviewDate: string;
  platformUrl: string | null;
}

interface WidgetApiData {
  businessName: string;
  config: WidgetConfig;
  reviews: WidgetReview[];
}

const PLATFORM_COLORS: Record<string, string> = {
  google: '#4285F4',
  yelp: '#D32323',
  facebook: '#1877F2',
};

function StarRow({ rating }: { rating: number }) {
  return (
    <div style={{ display: 'flex', gap: 2 }}>
      {[1, 2, 3, 4, 5].map((i) => (
        <svg key={i} viewBox="0 0 20 20" style={{ width: 13, height: 13, color: i <= rating ? '#f59e0b' : '#d1d5db' }} fill="currentColor">
          <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.286 3.956a1 1 0 00.95.69h4.162c.969 0 1.371 1.24.588 1.81l-3.37 2.449a1 1 0 00-.364 1.118l1.286 3.956c.3.921-.755 1.688-1.54 1.118L10 15.347l-3.37 2.449c-.784.57-1.838-.197-1.539-1.118l1.286-3.956a1 1 0 00-.364-1.118L2.643 9.383c-.783-.57-.38-1.81.588-1.81h4.162a1 1 0 00.95-.69l1.286-3.956z" />
        </svg>
      ))}
    </div>
  );
}

function timeAgo(dateStr: string) {
  const diff = (Date.now() - new Date(dateStr).getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 30) return `${Math.floor(diff / 86400)}d ago`;
  if (diff < 86400 * 365) return `${Math.floor(diff / 86400 / 30)}mo ago`;
  return `${Math.floor(diff / 86400 / 365)}y ago`;
}

function WidgetPreview({ widgetKey, cfg }: { widgetKey: string; cfg: WidgetConfig }) {
  const { data } = useSWR<{ success: boolean; data: WidgetApiData }>(
    widgetKey ? `/widget/${widgetKey}` : null,
    fetcher,
  );

  const isDark = cfg.theme === 'dark';
  const bg = isDark ? '#1a1a2e' : '#ffffff';
  const cardBg = isDark ? '#16213e' : '#f9fafb';
  const textMain = isDark ? '#f1f5f9' : '#111827';
  const textMuted = isDark ? '#94a3b8' : '#6b7280';
  const border = isDark ? '#334155' : '#e5e7eb';

  if (!data) {
    return (
      <div style={{ background: bg, border: `1px solid ${border}`, borderRadius: 12, padding: 20, textAlign: 'center', color: textMuted, fontSize: 13 }}>
        Loading preview…
      </div>
    );
  }

  const { businessName, reviews } = data.data;
  // Apply current (unsaved) config filters client-side for instant feedback
  const visible = reviews.filter((r) => r.rating >= cfg.minRating).slice(0, cfg.maxCount);

  return (
    <div style={{ fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif", background: bg, border: `1px solid ${border}`, borderRadius: 12, overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '10px 14px 8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: `1px solid ${border}` }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: textMain }}>{businessName} Reviews</span>
        <span style={{ fontSize: 11, color: textMuted }}>{visible.length} reviews</span>
      </div>
      {/* Cards */}
      <div style={{ overflowX: 'auto', padding: '10px 14px 12px' }}>
        {visible.length === 0 ? (
          <p style={{ fontSize: 12, color: textMuted, margin: 0 }}>No reviews match the current filter.</p>
        ) : (
          <div style={{ display: 'flex', gap: 10, width: 'max-content' }}>
            {visible.map((r, i) => {
              const platformColor = PLATFORM_COLORS[r.platform] || '#6b7280';
              const platformLabel = r.platform ? r.platform.charAt(0).toUpperCase() + r.platform.slice(1) : '';
              return (
                <div key={i} style={{ minWidth: 210, maxWidth: 250, flexShrink: 0, background: cardBg, border: `1px solid ${border}`, borderRadius: 10, padding: 12, display: 'flex', flexDirection: 'column', gap: 5 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: textMain, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 120 }}>{r.authorName || 'Anonymous'}</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                      <span style={{ fontSize: 10, color: textMuted }}>{timeAgo(r.reviewDate)}</span>
                      {cfg.showPlatformBadge && r.platform && (
                        <span style={{ fontSize: 10, fontWeight: 600, color: '#fff', background: platformColor, padding: '1px 6px', borderRadius: 10 }}>{platformLabel}</span>
                      )}
                    </div>
                  </div>
                  <StarRow rating={r.rating || 0} />
                  <p style={{ fontSize: 12, lineHeight: 1.5, color: textMuted, margin: 0, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical' } as React.CSSProperties}>
                    {r.body || ''}
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </div>
      {/* Footer */}
      <div style={{ padding: '4px 14px 8px', textAlign: 'right' }}>
        <span style={{ fontSize: 10, color: textMuted, opacity: 0.6 }}>powered by SuperLocalSEO</span>
      </div>
    </div>
  );
}

const ALL_PLATFORMS = ['Google', 'Yelp', 'Facebook', 'TripAdvisor'];

function WidgetAdvancedPanel({ widgetId }: { widgetId: string }) {
  const { data, mutate } = useSWR<{ success: boolean; data: { config: WidgetAdvancedConfig } }>(
    widgetId ? `/widget/${widgetId}/config` : null,
    fetcher,
  );
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<WidgetAdvancedConfig>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const cfg: WidgetAdvancedConfig = { ...data?.data?.config, ...draft };

  const togglePlatform = (p: string) => {
    const current = cfg.platforms ?? ALL_PLATFORMS.map((x) => x.toLowerCase());
    const lower = p.toLowerCase();
    const next = current.includes(lower) ? current.filter((x) => x !== lower) : [...current, lower];
    setDraft((d) => ({ ...d, platforms: next }));
  };

  const save = async () => {
    setSaving(true);
    try {
      await apiFetch(`/widget/${widgetId}/config`, {
        method: 'PUT',
        body: JSON.stringify(cfg),
      });
      await mutate();
      setDraft({});
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  };

  const activePlatforms = cfg.platforms ?? ALL_PLATFORMS.map((x) => x.toLowerCase());

  return (
    <div className="border-t pt-4 mt-4">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-slate-900 transition-colors"
      >
        {open ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
        Advanced settings
      </button>
      {open && (
        <div className="mt-4 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Only show reviews rated ★ or higher</label>
              <select
                value={cfg.minRating ?? 1}
                onChange={(e) => setDraft((d) => ({ ...d, minRating: Number(e.target.value) }))}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              >
                <option value={1}>1★ (all)</option>
                <option value={2}>2★</option>
                <option value={3}>3★</option>
                <option value={4}>4★</option>
                <option value={5}>5★ only</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Sort By</label>
              <select
                value={cfg.sortBy ?? 'newest'}
                onChange={(e) => setDraft((d) => ({ ...d, sortBy: e.target.value as WidgetAdvancedConfig['sortBy'] }))}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              >
                <option value="newest">Newest</option>
                <option value="highest">Highest rated</option>
                <option value="lowest">Lowest rated</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Max Reviews</label>
              <input
                type="number"
                min={1}
                max={50}
                value={cfg.reviewCount ?? 10}
                onChange={(e) => setDraft((d) => ({ ...d, reviewCount: Number(e.target.value) }))}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-2">Platform Filter</label>
            <div className="flex flex-wrap gap-3">
              {ALL_PLATFORMS.map((p) => (
                <label key={p} className="flex items-center gap-1.5 text-sm text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={activePlatforms.includes(p.toLowerCase())}
                    onChange={() => togglePlatform(p)}
                    className="rounded border-slate-200 text-brand-500 focus:ring-brand-500"
                  />
                  {p}
                </label>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Custom CSS</label>
            <textarea
              value={cfg.customCss ?? ''}
              onChange={(e) => setDraft((d) => ({ ...d, customCss: e.target.value }))}
              placeholder=".emr-widget { ... }"
              rows={4}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-brand-500 resize-none"
              style={{ height: 120 }}
            />
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving}
              className="px-4 py-2 bg-brand-500 text-white rounded-lg text-sm font-medium hover:bg-brand-600 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
            {saved && <span className="text-xs text-green-600 font-medium">Saved!</span>}
          </div>
        </div>
      )}
    </div>
  );
}

function WidgetTab() {
  const { data, mutate } = useSWR<{ success: boolean; data: WidgetData }>('/widget', fetcher);
  const widget = data?.data;

  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const [config, setConfig] = useState<Partial<WidgetConfig>>({});
  const [regenerating, setRegenerating] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

  const cfg: WidgetConfig = { ...widget?.config, ...config } as WidgetConfig;
  const key = widget?.widgetKey ?? '';

  const embedSnippet = key
    ? `<div data-sls-key="${key}"></div>\n<script src="${window.location.origin}/widget.js"></script>`
    : '';

  const copyEmbed = async () => {
    await navigator.clipboard.writeText(embedSnippet);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const saveConfig = async () => {
    setSaving(true);
    try {
      await apiFetch('/widget', { method: 'PATCH', body: JSON.stringify(cfg) });
      await mutate();
      setConfig({});
    } finally {
      setSaving(false);
    }
  };

  const regenerate = async () => {
    if (!confirm('This will break any existing embeds on your website. Continue?')) return;
    setRegenerating(true);
    try {
      await apiFetch('/widget/regenerate', { method: 'POST' });
      await mutate();
    } finally {
      setRegenerating(false);
    }
  };

  if (!widget) return <div className="space-y-3 animate-pulse">{[...Array(3)].map((_, i) => <div key={i} className="h-10 bg-slate-100 rounded-lg" />)}</div>;

  return (
    <div className="space-y-6">
      {/* Embed code */}
      <div>
        <h3 className="text-sm font-semibold text-slate-900 mb-2">Embed code</h3>
        <p className="text-xs text-slate-500 mb-3">Paste this snippet anywhere on your website to show your reviews.</p>
        <div className="relative">
          <pre className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-xs text-slate-700 overflow-x-auto whitespace-pre-wrap font-mono">{embedSnippet}</pre>
          <button
            onClick={() => void copyEmbed()}
            className="absolute top-2 right-2 px-2.5 py-1 bg-white border border-slate-200 rounded text-xs font-medium text-slate-600 hover:bg-slate-50"
          >
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>
      </div>

      {/* Config */}
      <div className="border-t pt-5">
        <h3 className="text-sm font-semibold text-slate-900 mb-4">Appearance</h3>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Theme</label>
            <select
              value={cfg.theme ?? 'light'}
              onChange={(e) => setConfig((c) => ({ ...c, theme: e.target.value as 'light' | 'dark' }))}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            >
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Reviews to show</label>
            <select
              value={cfg.maxCount ?? 8}
              onChange={(e) => setConfig((c) => ({ ...c, maxCount: Number(e.target.value) }))}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            >
              <option value={6}>6</option>
              <option value={8}>8</option>
              <option value={10}>10</option>
              <option value={20}>20</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Minimum rating</label>
            <select
              value={cfg.minRating ?? 4}
              onChange={(e) => setConfig((c) => ({ ...c, minRating: Number(e.target.value) }))}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            >
              <option value={1}>1★ and up (all)</option>
              <option value={3}>3★ and up</option>
              <option value={4}>4★ and up</option>
              <option value={5}>5★ only</option>
            </select>
          </div>
          <div className="flex items-center gap-3 pt-5">
            <input
              type="checkbox"
              id="showPlatformBadge"
              checked={cfg.showPlatformBadge ?? true}
              onChange={(e) => setConfig((c) => ({ ...c, showPlatformBadge: e.target.checked }))}
              className="rounded border-slate-200 text-brand-500 focus:ring-brand-500"
            />
            <label htmlFor="showPlatformBadge" className="text-sm text-slate-700">Show platform badge</label>
          </div>
        </div>
        <div className="mt-4 flex items-center gap-3">
          <button
            onClick={() => void saveConfig()}
            disabled={saving}
            className="px-4 py-2 bg-brand-500 text-white rounded-lg text-sm font-medium hover:bg-brand-600 disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save appearance'}
          </button>
          <button
            onClick={() => setShowPreview((v) => !v)}
            className="px-4 py-2 border border-slate-200 text-slate-700 rounded-lg text-sm font-medium hover:bg-slate-50"
          >
            {showPreview ? 'Hide preview' : 'Preview widget'}
          </button>
        </div>
      </div>

      {/* Live preview */}
      {showPreview && (
        <div className="border-t pt-5">
          <h3 className="text-sm font-semibold text-slate-900 mb-3">Live preview</h3>
          <p className="text-xs text-slate-500 mb-3">Reflects your current settings before saving.</p>
          <WidgetPreview widgetKey={key} cfg={cfg} />
        </div>
      )}

      {/* Advanced settings */}
      {widget.id && <WidgetAdvancedPanel widgetId={widget.id} />}

      {/* Danger zone */}
      <div className="border-t pt-5">
        <h3 className="text-sm font-semibold text-slate-900 mb-1">Regenerate widget key</h3>
        <p className="text-xs text-slate-500 mb-3">This invalidates your current embed. You'll need to update the snippet on your website.</p>
        <button
          onClick={() => void regenerate()}
          disabled={regenerating}
          className="px-4 py-2 text-sm font-medium text-red-600 border border-red-200 rounded-lg hover:bg-red-50 disabled:opacity-50"
        >
          {regenerating ? 'Regenerating...' : 'Regenerate key'}
        </button>
      </div>
    </div>
  );
}

// ─── QR Codes tab ────────────────────────────────────────────────────────────

interface QRCodeEntry {
  id: string;
  name: string;
  targetUrl: string;
  shortCode: string;
  scanCount: number;
  lastScannedAt: string | null;
  createdAt: string;
  locationName: string | null;
  qrUrl: string;
}

interface Location {
  id: string;
  name: string;
  google_place_id: string | null;
}

function QRTab() {
  const { data, isLoading } = useSWR<{ success: boolean; data: { qrCodes: QRCodeEntry[] } }>('/qr', fetcher);
  const { data: locsData } = useSWR<{ success: boolean; data: { locations: Location[] } }>('/locations', fetcher);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', targetUrl: '', locationId: '' });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formOk, setFormOk] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);

  const qrCodes = data?.data?.qrCodes ?? [];
  const locations = locsData?.data?.locations ?? [];

  function getReviewUrl(loc: Location) {
    if (!loc.google_place_id) return '';
    return `https://search.google.com/local/writereview?placeid=${loc.google_place_id}`;
  }

  function handleLocationChange(locId: string) {
    setForm((p) => {
      const loc = locations.find((l) => l.id === locId);
      const reviewUrl = loc ? getReviewUrl(loc) : '';
      return { ...p, locationId: locId, targetUrl: reviewUrl || p.targetUrl };
    });
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setFormError(null);
    setFormOk(false);
    try {
      const res = await apiFetch<{ success: boolean; error?: { message: string } }>('/qr', {
        method: 'POST',
        body: JSON.stringify({
          name: form.name,
          targetUrl: form.targetUrl,
          locationId: form.locationId || undefined,
        }),
      });
      if (!res.success) {
        setFormError((res as { error?: { message: string } }).error?.message ?? 'Failed');
        return;
      }
      setFormOk(true);
      setForm({ name: '', targetUrl: '', locationId: '' });
      setShowForm(false);
      void swrMutate('/qr');
    } catch {
      setFormError('Network error');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(`Delete QR code "${name}"?`)) return;
    await apiFetch(`/qr/${id}`, { method: 'DELETE' });
    void swrMutate('/qr');
  }

  function downloadImage(id: string, name: string) {
    const a = document.createElement('a');
    a.href = `/api/qr/${id}/image.png`;
    a.download = `qr-${name.replace(/\s+/g, '-').toLowerCase()}.png`;
    a.click();
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">Generate printable QR codes that link customers directly to your Google review page. Scans are tracked automatically.</p>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="flex items-center gap-2 px-3 py-2 bg-brand-500 text-white text-sm font-medium rounded-lg hover:bg-brand-600 transition-colors"
        >
          <Plus size={14} /> New QR code
        </button>
      </div>

      {showForm && (
        <form onSubmit={(e) => void handleCreate(e)} className="border border-slate-200 rounded-xl p-5 bg-slate-50 space-y-4">
          <h4 className="font-medium text-slate-800">Create QR code</h4>
          <div className="space-y-3">
            <div>
              <label className="block text-xs text-slate-500 mb-1">Name *</label>
              <input
                required
                value={form.name}
                onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                placeholder="Front desk card"
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 bg-white"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">Location (optional)</label>
              <select
                value={form.locationId}
                onChange={(e) => handleLocationChange(e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 bg-white"
              >
                <option value="">— None —</option>
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {[l.name, l.city, l.state].filter(Boolean).join(', ')}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">Target URL (Google review link) *</label>
            <input
              required
              type="url"
              value={form.targetUrl}
              onChange={(e) => setForm((p) => ({ ...p, targetUrl: e.target.value }))}
              placeholder="https://search.google.com/local/writereview?placeid=…"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand-500 bg-white"
            />
            <p className="text-xs text-slate-400 mt-1">
              Get your Google review link from{' '}
              <a href="https://business.google.com" target="_blank" rel="noopener noreferrer" className="text-brand-500 hover:underline">Google Business Profile</a>.
              {form.locationId && locations.find((l) => l.id === form.locationId)?.google_place_id && (
                <span className="text-green-600 ml-1">Auto-filled from location.</span>
              )}
            </p>
          </div>
          {formError && <div className="flex items-center gap-2 text-red-600 text-sm"><AlertCircle size={13} /> {formError}</div>}
          {formOk && <div className="flex items-center gap-2 text-green-700 text-sm"><CheckCircle2 size={13} /> Created!</div>}
          <div className="flex justify-end gap-3">
            <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2 text-sm text-slate-600 hover:text-slate-900">Cancel</button>
            <button type="submit" disabled={saving} className="px-4 py-2 bg-brand-500 text-white text-sm font-medium rounded-lg hover:bg-brand-600 disabled:opacity-50 transition-colors">
              {saving ? 'Creating…' : 'Create'}
            </button>
          </div>
        </form>
      )}

      {isLoading && (
        <div className="space-y-3">
          {[1, 2].map((n) => <div key={n} className="h-20 bg-slate-100 rounded-xl animate-pulse" />)}
        </div>
      )}

      {!isLoading && qrCodes.length === 0 && !showForm && (
        <div className="border-2 border-dashed border-slate-200 rounded-xl py-12 text-center">
          <QrCode size={36} className="mx-auto text-slate-300 mb-3" />
          <p className="text-sm text-slate-500 font-medium">No QR codes yet</p>
          <p className="text-xs text-slate-400 mt-1">Create one to start directing customers to your review page</p>
        </div>
      )}

      {qrCodes.length > 0 && (
        <div className="space-y-3">
          {qrCodes.map((qr) => (
            <div key={qr.id} className="flex items-center gap-4 border border-slate-200 rounded-xl px-5 py-4 bg-white">
              <img
                ref={imgRef}
                src={`/api/qr/${qr.id}/image.png`}
                alt={`QR code for ${qr.name}`}
                className="w-14 h-14 rounded border border-slate-100"
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-slate-800">{qr.name}</span>
                  {qr.locationName && <span className="text-xs bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">{qr.locationName}</span>}
                </div>
                <a href={qr.targetUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-brand-500 hover:underline flex items-center gap-1 mt-0.5 truncate">
                  <ExternalLink size={10} /> {qr.targetUrl.length > 50 ? `${qr.targetUrl.slice(0, 50)}…` : qr.targetUrl}
                </a>
                <p className="text-xs text-slate-400 mt-0.5">
                  {qr.scanCount.toLocaleString()} scan{qr.scanCount !== 1 ? 's' : ''}
                  {qr.lastScannedAt && ` · last ${new Date(qr.lastScannedAt).toLocaleDateString()}`}
                </p>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => downloadImage(qr.id, qr.name)}
                  title="Download PNG"
                  className="p-1.5 rounded-lg text-slate-400 hover:text-brand-500 hover:bg-slate-100 transition-colors"
                >
                  <Download size={15} />
                </button>
                <button
                  onClick={() => void handleDelete(qr.id, qr.name)}
                  title="Delete"
                  className="p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Team tab ─────────────────────────────────────────────────────────────────

function TeamTab() {
  const { data, isLoading, mutate } = useSWR<{ success: boolean; data: TeamData }>('/team', fetcher);
  const team = data?.data;

  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'admin' | 'viewer'>('viewer');
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState('');
  const [inviteSuccess, setInviteSuccess] = useState('');

  const sendInvite = async () => {
    setInviting(true);
    setInviteError('');
    setInviteSuccess('');
    try {
      const res = await apiFetch<{ success: boolean; error?: { message: string } }>('/team/invite', {
        method: 'POST',
        body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
      });
      if (!res.success) {
        setInviteError((res as { error?: { message: string } }).error?.message ?? 'Failed to send invite');
      } else {
        setInviteSuccess(`Invitation sent to ${inviteEmail}`);
        setInviteEmail('');
        await mutate();
      }
    } catch {
      setInviteError('Failed to send invite');
    } finally {
      setInviting(false);
    }
  };

  const removeMember = async (memberId: string) => {
    await apiFetch(`/team/${memberId}`, { method: 'DELETE' });
    await mutate();
  };

  if (isLoading) {
    return <div className="space-y-3 animate-pulse">{[...Array(3)].map((_, i) => <div key={i} className="h-12 bg-slate-100 rounded-lg" />)}</div>;
  }

  return (
    <div className="space-y-6">
      {/* Member list */}
      <div className="space-y-2">
        {team?.owner && (
          <div className="flex items-center justify-between py-3 px-4 bg-slate-50 rounded-lg">
            <div>
              <p className="text-sm font-medium text-slate-900">{team.owner.email}</p>
              <p className="text-xs text-slate-400">Account owner</p>
            </div>
            <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-brand-100 text-brand-700">Owner</span>
          </div>
        )}
        {team?.members.map((m) => (
          <div key={m.id} className="flex items-center justify-between py-3 px-4 border border-slate-200 rounded-lg">
            <div>
              <p className="text-sm font-medium text-slate-900">{m.email}</p>
              <p className="text-xs text-slate-400">
                {m.accepted ? 'Active' : m.expired ? 'Invite expired' : 'Invite pending'}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 capitalize">{m.role}</span>
              <button
                onClick={() => void removeMember(m.id)}
                className="text-xs text-red-500 hover:text-red-700 font-medium"
              >
                Remove
              </button>
            </div>
          </div>
        ))}
        {!team?.members.length && (
          <p className="text-sm text-slate-400 text-center py-4">No team members yet.</p>
        )}
      </div>

      {/* Invite form */}
      <div className="border-t pt-5">
        <h3 className="text-sm font-semibold text-slate-900 mb-3">Invite team member</h3>
        <div className="flex gap-2">
          <input
            type="email"
            placeholder="email@example.com"
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
            className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
          <select
            value={inviteRole}
            onChange={(e) => setInviteRole(e.target.value as 'admin' | 'viewer')}
            className="border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          >
            <option value="viewer">Viewer</option>
            <option value="admin">Admin</option>
          </select>
          <button
            onClick={() => void sendInvite()}
            disabled={inviting || !inviteEmail}
            className="px-4 py-2 bg-brand-500 text-white rounded-lg text-sm font-medium hover:bg-brand-600 disabled:opacity-50"
          >
            {inviting ? 'Sending...' : 'Invite'}
          </button>
        </div>
        {inviteError && <p className="mt-2 text-sm text-red-600">{inviteError}</p>}
        {inviteSuccess && <p className="mt-2 text-sm text-green-600">{inviteSuccess}</p>}
        <p className="mt-2 text-xs text-slate-400">Admins can manage locations and keywords. Viewers have read-only access.</p>
      </div>
    </div>
  );
}

// ─── ROI Settings section ─────────────────────────────────────────────────────

interface RoiConfig {
  avgCustomerValue: number;
  conversionRate: number;
}

function RoiSettingsSection() {
  const { data, mutate } = useSWR<{ success: boolean; data: { roiConfig: RoiConfig } }>('/analytics/roi', fetcher);
  const roiConfig = data?.data?.roiConfig;

  const [acv, setAcv] = useState('');
  const [conv, setConv] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const resolvedAcv = acv !== '' ? acv : String(roiConfig?.avgCustomerValue ?? '');
  const resolvedConv = conv !== '' ? conv : String(roiConfig?.conversionRate ?? '');

  const save = async () => {
    setSaving(true);
    try {
      await apiFetch('/analytics/roi-config', {
        method: 'PATCH',
        body: JSON.stringify({
          avgCustomerValue: parseFloat(resolvedAcv) || 0,
          conversionRate: parseFloat(resolvedConv) || 2.5,
        }),
      });
      await mutate();
      setAcv('');
      setConv('');
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="border-t pt-5">
      <h3 className="text-sm font-semibold text-slate-900 mb-1">ROI Settings</h3>
      <p className="text-xs text-slate-500 mb-4">Used to estimate monthly revenue value from your keyword rankings.</p>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Average Customer Value ($)</label>
          <input
            type="number"
            min={0}
            value={resolvedAcv}
            onChange={(e) => setAcv(e.target.value)}
            placeholder="500"
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Conversion Rate (%)</label>
          <input
            type="number"
            min={0}
            max={100}
            step={0.1}
            value={resolvedConv}
            onChange={(e) => setConv(e.target.value)}
            placeholder="3"
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>
      </div>
      <p className="mt-3 text-xs text-slate-400">
        Est. monthly revenue = keyword impressions × CTR × {resolvedConv || '3'}% × ${resolvedAcv || '500'}
      </p>
      <div className="mt-3 flex items-center gap-3">
        <button
          onClick={() => void save()}
          disabled={saving}
          className="px-4 py-2 bg-brand-500 text-white rounded-lg text-sm font-medium hover:bg-brand-600 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save ROI Settings'}
        </button>
        {saved && <span className="text-sm text-green-600 font-medium">ROI settings saved</span>}
      </div>
    </div>
  );
}

// ─── Locations tab ───────────────────────────────────────────────────────────

interface Location {
  id: string;
  name: string;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  phone: string | null;
  website: string | null;
  isPrimary: boolean;
  brightlocalCampaignId: string | null;
  serviceArea: string[];
  lat: number | null;
  lng: number | null;
}

interface LocForm {
  name: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  phone: string;
  website: string;
  serviceArea: string[];
}

const EMPTY_LOC_FORM: LocForm = { name: '', address: '', city: '', state: '', zip: '', phone: '', website: '', serviceArea: [] };
const EXTRA_LOCATION_PRICE = 125;

function locFormFromLocation(loc: Location): LocForm {
  return {
    name: loc.name,
    address: loc.address ?? '',
    city: loc.city ?? '',
    state: loc.state ?? '',
    zip: loc.zip ?? '',
    phone: loc.phone ?? '',
    website: loc.website ?? '',
    serviceArea: loc.serviceArea ?? [],
  };
}

interface CitySuggestion { city: string; state: string | null; label: string; }

function LocationForm({
  initial, onSave, onCancel, saving, error, lat, lng,
}: {
  initial: LocForm;
  onSave: (form: LocForm) => void;
  onCancel: () => void;
  saving: boolean;
  error: string | null;
  lat?: number | null;
  lng?: number | null;
}) {
  const [form, setForm] = useState<LocForm>(initial);
  const [cityInput, setCityInput] = useState('');
  const [suggestions, setSuggestions] = useState<CitySuggestion[]>([]);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const set = (k: keyof LocForm) => (e: ChangeEvent<HTMLInputElement>) =>
    setForm((p) => ({ ...p, [k]: e.target.value }));

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setSuggestionsOpen(false);
      }
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  function onCityInputChange(e: ChangeEvent<HTMLInputElement>) {
    const val = e.target.value;
    setCityInput(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (val.trim().length < 2) { setSuggestions([]); setSuggestionsOpen(false); return; }
    debounceRef.current = setTimeout(async () => {
      setLoadingSuggestions(true);
      try {
        const params = new URLSearchParams({ q: val.trim() });
        if (lat != null && lng != null) { params.set('lat', String(lat)); params.set('lng', String(lng)); }
        const res = await apiFetch<{ success: boolean; data: CitySuggestion[] }>(`/places/cities?${params}`);
        if (res.success && res.data.length > 0) {
          setSuggestions(res.data);
          setSuggestionsOpen(true);
        } else {
          setSuggestions([]);
          setSuggestionsOpen(false);
        }
      } catch { /* ignore */ } finally {
        setLoadingSuggestions(false);
      }
    }, 300);
  }

  function selectSuggestion(s: CitySuggestion) {
    const label = s.label;
    if (!form.serviceArea.includes(label)) {
      setForm((p) => ({ ...p, serviceArea: [...p.serviceArea, label] }));
    }
    setCityInput('');
    setSuggestions([]);
    setSuggestionsOpen(false);
  }

  function addCityManual() {
    const trimmed = cityInput.trim();
    if (!trimmed || form.serviceArea.includes(trimmed)) { setCityInput(''); return; }
    setForm((p) => ({ ...p, serviceArea: [...p.serviceArea, trimmed] }));
    setCityInput('');
    setSuggestions([]);
    setSuggestionsOpen(false);
  }

  function removeCity(city: string) {
    setForm((p) => ({ ...p, serviceArea: p.serviceArea.filter((c) => c !== city) }));
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <label className="block text-xs text-slate-500 mb-1">Location name *</label>
          <input autoFocus value={form.name} onChange={set('name')} placeholder="e.g. Main Office"
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
        </div>
        <div className="col-span-2">
          <label className="block text-xs text-slate-500 mb-1">Address</label>
          <input value={form.address} onChange={set('address')} placeholder="123 Main St"
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
        </div>
        <div>
          <label className="block text-xs text-slate-500 mb-1">City</label>
          <input value={form.city} onChange={set('city')} placeholder="Austin"
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-xs text-slate-500 mb-1">State</label>
            <input value={form.state} onChange={set('state')} placeholder="TX"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">ZIP</label>
            <input value={form.zip} onChange={set('zip')} placeholder="78701"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
          </div>
        </div>
        <div>
          <label className="block text-xs text-slate-500 mb-1">Phone</label>
          <input value={form.phone} onChange={set('phone')} placeholder="+15125550100"
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
        </div>
        <div>
          <label className="block text-xs text-slate-500 mb-1">Website</label>
          <input value={form.website} onChange={set('website')} placeholder="https://..."
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
        </div>
        <div className="col-span-2">
          <label className="block text-xs text-slate-500 mb-1">Service area cities <span className="text-slate-400">(used for search volume estimates)</span></label>
          {form.serviceArea.length > 0 && (
            <div className="flex flex-wrap gap-1 mb-2">
              {form.serviceArea.map((city) => (
                <span key={city} className="inline-flex items-center gap-1 bg-brand-50 text-brand-700 text-xs font-medium px-2 py-1 rounded-full border border-brand-200">
                  {city}
                  <button type="button" onClick={() => removeCity(city)} className="hover:text-brand-900 leading-none">&times;</button>
                </span>
              ))}
            </div>
          )}
          <div ref={wrapperRef} className="relative">
            <div className="flex gap-2">
              <input
                value={cityInput}
                onChange={onCityInputChange}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); suggestionsOpen && suggestions[0] ? selectSuggestion(suggestions[0]) : addCityManual(); } if (e.key === 'Escape') setSuggestionsOpen(false); }}
                placeholder="Search for a city…"
                className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                autoComplete="off"
              />
              {!suggestionsOpen && (
                <button type="button" onClick={addCityManual}
                  className="px-3 py-2 bg-slate-100 text-slate-600 text-sm rounded-lg hover:bg-slate-200 transition-colors whitespace-nowrap">
                  Add
                </button>
              )}
            </div>
            {suggestionsOpen && suggestions.length > 0 && (
              <ul className="absolute z-50 left-0 right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg overflow-hidden">
                {suggestions.map((s) => (
                  <li key={s.label}>
                    <button type="button" onMouseDown={(e) => { e.preventDefault(); selectSuggestion(s); }}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-brand-50 flex items-center justify-between gap-2">
                      <span className="font-medium text-slate-800">{s.city}</span>
                      {s.state && <span className="text-xs text-slate-400 shrink-0">{s.state}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {loadingSuggestions && (
              <p className="absolute right-3 top-2.5 text-xs text-slate-400">Searching…</p>
            )}
          </div>
          <p className="text-xs text-slate-400 mt-1">Type to search verified cities. Press Enter to select the first result.</p>
        </div>
      </div>
      {error && (
        <div className="flex items-center gap-2 text-red-600 text-xs">
          <AlertCircle size={13} /> {error}
        </div>
      )}
      <div className="flex gap-2">
        <button onClick={() => onSave(form)} disabled={saving || !form.name.trim()}
          className="px-4 py-2 bg-brand-500 text-white text-sm font-medium rounded-lg hover:bg-brand-600 disabled:opacity-50 transition-colors">
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button onClick={onCancel} disabled={saving}
          className="px-4 py-2 border border-slate-200 text-sm text-slate-600 rounded-lg hover:bg-slate-50 disabled:opacity-50 transition-colors">
          Cancel
        </button>
      </div>
    </div>
  );
}

function LocationsTab({ isAdmin }: { isAdmin: boolean }) {
  const { data, mutate } = useSWR<{ success: boolean; data: Location[] }>('/locations', fetcher);
  const { data: billingData } = useSWR<BillingResponse>('/billing/status', fetcher);

  const locations = data?.data ?? [];
  const included = billingData?.data?.locationsLimit ?? 1;
  const extraPrice = EXTRA_LOCATION_PRICE;

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const [showAdd, setShowAdd] = useState(false);
  const [addSaving, setAddSaving] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function handleSaveEdit(id: string, form: LocForm) {
    setEditSaving(true);
    setEditError(null);
    try {
      const res = await apiFetch<{ success: boolean; error?: { message: string } }>(`/locations/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(form),
      });
      if (!res.success) {
        setEditError((res as { error?: { message: string } }).error?.message ?? 'Failed to save');
        return;
      }
      await mutate();
      setEditingId(null);
    } catch {
      setEditError('Network error');
    } finally {
      setEditSaving(false);
    }
  }

  async function handleAdd(form: LocForm) {
    setAddSaving(true);
    setAddError(null);
    try {
      const res = await apiFetch<{ success: boolean; error?: { message: string } }>('/locations', {
        method: 'POST',
        body: JSON.stringify(form),
      });
      if (!res.success) {
        setAddError((res as { error?: { message: string } }).error?.message ?? 'Failed to add location');
        return;
      }
      await mutate();
      setShowAdd(false);
    } catch {
      setAddError('Network error');
    } finally {
      setAddSaving(false);
    }
  }

  async function handleDelete(id: string) {
    setDeleting(true);
    try {
      await apiFetch(`/locations/${id}`, { method: 'DELETE' }, true);
      await mutate();
      setConfirmDelete(null);
    } catch {
      // non-fatal
    } finally {
      setDeleting(false);
    }
  }

  const isOverLimit = locations.length > included;
  const isAtLimit = locations.length >= included;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-slate-600">
            {locations.length} location{locations.length !== 1 ? 's' : ''}
            {` · ${Math.min(locations.length, included)} of ${included} included in your plan`}
          </p>
          {isOverLimit && (
            <p className="text-xs text-slate-400 mt-0.5">
              {locations.length - included} extra at ${extraPrice}/mo each
            </p>
          )}
        </div>
        {isAdmin && !showAdd && (
          <button
            onClick={() => setShowAdd(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-brand-500 text-white text-sm font-medium rounded-lg hover:bg-brand-600 transition-colors"
          >
            <Plus size={14} /> Add location
          </button>
        )}
      </div>

      {locations.map((loc) => (
        <div key={loc.id} className="border border-slate-200 rounded-xl p-4">
          {editingId === loc.id ? (
            <LocationForm
              initial={locFormFromLocation(loc)}
              onSave={(form) => void handleSaveEdit(loc.id, form)}
              onCancel={() => { setEditingId(null); setEditError(null); }}
              saving={editSaving}
              error={editError}
              lat={loc.lat}
              lng={loc.lng}
            />
          ) : (
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-sm text-slate-900">{loc.name}</span>
                  {loc.isPrimary && (
                    <span className="text-xs px-2 py-0.5 bg-brand-50 text-brand-600 rounded-full font-medium">Primary</span>
                  )}
                  {loc.lat != null && loc.lng != null ? (
                    <span className="text-xs px-2 py-0.5 bg-green-50 text-green-600 rounded-full font-medium" title={`${loc.lat.toFixed(5)}, ${loc.lng.toFixed(5)}`}>Geocoded</span>
                  ) : (loc.address || loc.city) ? (
                    <span className="text-xs px-2 py-0.5 bg-slate-100 text-slate-400 rounded-full">No coordinates</span>
                  ) : null}
                </div>
                {(loc.address || loc.city) && (
                  <p className="text-xs text-slate-500 mt-0.5">
                    {[loc.address, loc.city, loc.state, loc.zip].filter(Boolean).join(', ')}
                  </p>
                )}
                {(loc.phone || loc.website) && (
                  <p className="text-xs text-slate-400 mt-0.5">
                    {loc.phone && <span className="mr-3">{loc.phone}</span>}
                    {loc.website && (
                      <a href={loc.website} target="_blank" rel="noopener noreferrer" className="hover:underline" title={loc.website}>
                        {(() => { try { return new URL(loc.website).hostname.replace(/^www\./, ''); } catch { return loc.website; } })()}
                      </a>
                    )}
                  </p>
                )}
                {loc.serviceArea.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    <span className="text-xs text-slate-400 mr-0.5">Serves:</span>
                    {loc.serviceArea.map((city) => (
                      <span key={city} className="text-xs bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded-full">{city}</span>
                    ))}
                  </div>
                )}
              </div>
              {isAdmin && (
                <div className="flex items-center gap-2 shrink-0">
                  {confirmDelete === loc.id ? (
                    <>
                      <span className="text-xs text-slate-500">Delete?</span>
                      <button onClick={() => void handleDelete(loc.id)} disabled={deleting}
                        className="text-xs text-red-600 hover:text-red-700 font-medium disabled:opacity-50">Yes</button>
                      <button onClick={() => setConfirmDelete(null)} className="text-xs text-slate-500 hover:text-slate-700">No</button>
                    </>
                  ) : (
                    <>
                      <button onClick={() => { setEditingId(loc.id); setEditError(null); }}
                        className="text-xs text-brand-600 hover:text-brand-700 font-medium">Edit</button>
                      {locations.length > 1 && (
                        <button onClick={() => setConfirmDelete(loc.id)} className="text-slate-300 hover:text-red-500 transition-colors">
                          <Trash2 size={14} />
                        </button>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      ))}

      {showAdd && isAdmin && (
        <div className="border border-brand-200 bg-brand-50/30 rounded-xl p-4">
          {isAtLimit && (
            <div className="flex items-start gap-2 text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs mb-4">
              <AlertCircle size={13} className="mt-0.5 shrink-0" />
              <span>
                You've used all {included} included location{included !== 1 ? 's' : ''}. This location will be billed at an additional ${extraPrice}/mo.
              </span>
            </div>
          )}
          <p className="text-sm font-medium text-slate-700 mb-3">New location</p>
          <LocationForm
            initial={EMPTY_LOC_FORM}
            onSave={(form) => void handleAdd(form)}
            onCancel={() => { setShowAdd(false); setAddError(null); }}
            saving={addSaving}
            error={addError}
          />
        </div>
      )}
    </div>
  );
}

// ─── Keywords tab ────────────────────────────────────────────────────────────

interface Keyword {
  id: string;
  locationId: string;
  keyword: string;
}

function KeywordsTab({ isAdmin }: { isAdmin: boolean }) {
  const { data: locsData } = useSWR<{ success: boolean; data: Location[] }>('/locations', fetcher);
  const locations = locsData?.data ?? [];

  const [selectedLocationId, setSelectedLocationId] = useState<string>('');
  const activeLocationId = selectedLocationId || locations[0]?.id || '';

  const kwUrl = activeLocationId ? `/keywords?locationId=${activeLocationId}` : null;
  const { data: kwData, mutate: mutateKw } = useSWR<{ success: boolean; data: Keyword[] }>(kwUrl, fetcher);
  const keywords = kwData?.data ?? [];

  const [newKeyword, setNewKeyword] = useState('');
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Synchronous in-flight guard against double-submit (setAdding is async).
  const addingRef = useRef(false);
  async function handleAdd() {
    const kw = newKeyword.trim();
    if (!kw || !activeLocationId || addingRef.current) return;
    addingRef.current = true;
    setAdding(true);
    setAddError(null);
    try {
      const res = await apiFetch<{ success: boolean; error?: { message: string } }>('/keywords', {
        method: 'POST',
        body: JSON.stringify({ locationId: activeLocationId, keyword: kw }),
      });
      if (!res.success) {
        setAddError((res as { error?: { message: string } }).error?.message ?? 'Failed to add keyword');
        return;
      }
      setNewKeyword('');
      await mutateKw();
    } catch {
      setAddError('Network error');
    } finally {
      setAdding(false);
      addingRef.current = false;
    }
  }

  async function handleDelete(id: string) {
    setDeleting(true);
    try {
      await apiFetch(`/keywords/${id}`, { method: 'DELETE' }, true);
      await mutateKw();
      setConfirmDelete(null);
    } catch {
      // non-fatal
    } finally {
      setDeleting(false);
    }
  }

  if (locations.length === 0) {
    return (
      <p className="text-sm text-slate-400">Add a location first before managing keywords.</p>
    );
  }

  return (
    <div className="space-y-4">
      {/* Location selector */}
      {locations.length > 1 && (
        <div>
          <label className="block text-xs text-slate-500 mb-1">Location</label>
          <select
            value={activeLocationId}
            onChange={(e) => setSelectedLocationId(e.target.value)}
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          >
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {[l.name, l.city, l.state].filter(Boolean).join(', ')}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Keyword list */}
      <div className="border border-slate-200 rounded-xl overflow-hidden">
        {keywords.length === 0 ? (
          <p className="px-4 py-6 text-sm text-slate-400 text-center">No keywords yet — add one below.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {keywords.map((kw) => (
              <li key={kw.id} className="flex items-center justify-between px-4 py-2.5">
                <span className="text-sm text-slate-800">{kw.keyword}</span>
                {isAdmin && (
                  <div className="flex items-center gap-2 shrink-0 ml-4">
                    {confirmDelete === kw.id ? (
                      <>
                        <span className="text-xs text-slate-500">Remove?</span>
                        <button onClick={() => void handleDelete(kw.id)} disabled={deleting}
                          className="text-xs text-red-600 hover:text-red-700 font-medium disabled:opacity-50">Yes</button>
                        <button onClick={() => setConfirmDelete(null)} className="text-xs text-slate-500 hover:text-slate-700">No</button>
                      </>
                    ) : (
                      <button onClick={() => setConfirmDelete(kw.id)} className="text-slate-300 hover:text-red-500 transition-colors">
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Add keyword */}
      {isAdmin && (
        <div className="space-y-2">
          <div className="flex gap-2">
            <input
              value={newKeyword}
              onChange={(e) => { setNewKeyword(e.target.value); setAddError(null); }}
              onKeyDown={(e) => { if (e.key === 'Enter') void handleAdd(); }}
              placeholder="e.g. personal trainer near me"
              className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
            <button
              onClick={() => void handleAdd()}
              disabled={adding || !newKeyword.trim()}
              className="flex items-center gap-1.5 px-4 py-2 bg-brand-500 text-white text-sm font-medium rounded-lg hover:bg-brand-600 disabled:opacity-50 transition-colors"
            >
              <Plus size={14} /> {adding ? 'Adding…' : 'Add'}
            </button>
          </div>
          {addError && (
            <div className="flex items-center gap-2 text-red-600 text-xs">
              <AlertCircle size={13} /> {addError}
            </div>
          )}
          <p className="text-xs text-slate-400">Press Enter or click Add. Duplicates are rejected automatically.</p>
        </div>
      )}
    </div>
  );
}

// ─── Billing tab ─────────────────────────────────────────────────────────────

interface BillingStatus {
  status: string;
  trialDaysLeft: number | null;
  trialEndsAt: string | null;
  locationsLimit: number;
  locationCount: number;
  currentPeriodEnd: string | null;
  paymentFailedAt: string | null;
  publishableKey: string | null;
}

interface BillingResponse {
  success: boolean;
  data: BillingStatus;
}

// ─── White-label settings ─────────────────────────────────────────────────────

interface WhiteLabelData {
  companyName: string | null;
  logoUrl: string | null;
  color: string | null;
}

function WhiteLabelSection() {
  const { data, mutate } = useSWR<{ success: boolean; data: { whiteLabel: WhiteLabelData } }>('/clients', fetcher);
  const saved = data?.data?.whiteLabel;

  const [companyName, setCompanyName] = useState('');
  const [logoUrl, setLogoUrl] = useState('');
  const [color, setColor] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedOk, setSavedOk] = useState(false);
  const [saveError, setSaveError] = useState('');

  const resolvedName = companyName !== '' ? companyName : (saved?.companyName ?? '');
  const resolvedLogo = logoUrl !== '' ? logoUrl : (saved?.logoUrl ?? '');
  const resolvedColor = color !== '' ? color : (saved?.color ?? '#0052CC');

  const save = async () => {
    setSaving(true);
    setSaveError('');
    setSavedOk(false);
    try {
      const res = await apiFetch<{ success: boolean; error?: { message: string } }>('/clients', {
        method: 'PATCH',
        body: JSON.stringify({
          whiteLabelCompanyName: resolvedName || null,
          whiteLabelLogoUrl: resolvedLogo || null,
          whiteLabelColor: resolvedColor,
        }),
      });
      if (!res.success) {
        setSaveError((res as { error?: { message: string } }).error?.message ?? 'Failed to save');
      } else {
        await mutate();
        setCompanyName('');
        setLogoUrl('');
        setColor('');
        setSavedOk(true);
        setTimeout(() => setSavedOk(false), 3000);
      }
    } catch {
      setSaveError('Network error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="border-t pt-5">
      <h3 className="text-sm font-semibold text-slate-900 mb-1">White-Label Reports</h3>
      <p className="text-xs text-slate-500 mb-4">Customize the branding on your monthly PDF reports. Leave blank to use SuperLocalSEO defaults.</p>
      <div className="space-y-3">
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Company Name</label>
          <input
            type="text"
            value={resolvedName}
            onChange={(e) => setCompanyName(e.target.value)}
            placeholder="Your Agency Name"
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Logo URL</label>
          <input
            type="url"
            value={resolvedLogo}
            onChange={(e) => setLogoUrl(e.target.value)}
            placeholder="https://yoursite.com/logo.png"
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
          <p className="text-xs text-slate-400 mt-1">PNG or SVG, publicly accessible. Will appear in the report header.</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex-1">
            <label className="block text-xs font-medium text-slate-600 mb-1">Brand Color</label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={resolvedColor}
                onChange={(e) => setColor(e.target.value)}
                className="h-9 w-14 border border-slate-200 rounded-lg cursor-pointer p-0.5"
              />
              <input
                type="text"
                value={resolvedColor}
                onChange={(e) => setColor(e.target.value)}
                placeholder="#0052CC"
                className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
            </div>
          </div>
        </div>
        {saveError && <p className="text-xs text-red-600">{saveError}</p>}
        <div className="flex items-center gap-3">
          <button
            onClick={() => void save()}
            disabled={saving}
            className="px-4 py-2 bg-brand-500 text-white rounded-lg text-sm font-medium hover:bg-brand-600 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save branding'}
          </button>
          {savedOk && <span className="text-xs text-green-600 font-medium">Saved!</span>}
        </div>
      </div>
    </div>
  );
}

function BillingTab({ onGoToLocations, isAdmin, isPlatformAdmin }: { onGoToLocations: () => void; isAdmin: boolean; isPlatformAdmin: boolean }) {
  const { data, isLoading, mutate: mutateBilling } = useSWR<BillingResponse>('/billing/status', fetcher, { refreshInterval: 30000 });
  const { data: locData, mutate: mutateLocs } = useSWR<{ success: boolean; data: Location[] }>('/locations', fetcher);
  const billing = data?.data;
  const locations = locData?.data ?? [];
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [portalLoading, setPortalLoading] = useState(false);
  const [actionError, setActionError] = useState('');
  const [showAddLoc, setShowAddLoc] = useState(false);
  const [addLocSaving, setAddLocSaving] = useState(false);
  const [addLocError, setAddLocError] = useState<string | null>(null);

  async function handleAddLocation(form: LocForm) {
    setAddLocSaving(true);
    setAddLocError(null);
    try {
      const res = await apiFetch<{ success: boolean; error?: { message: string } }>('/locations', {
        method: 'POST',
        body: JSON.stringify(form),
      });
      if (!res.success) { setAddLocError(res.error?.message ?? 'Failed to add location'); return; }
      await Promise.all([mutateLocs(), mutateBilling()]);
      setShowAddLoc(false);
    } catch {
      setAddLocError('Network error');
    } finally {
      setAddLocSaving(false);
    }
  }

  const startCheckout = async () => {
    setCheckoutLoading(true);
    setActionError('');
    try {
      const res = await apiFetch<{ success: boolean; data: { url: string }; error?: { message: string } }>('/billing/checkout', {
        method: 'POST',
        body: JSON.stringify({ extraLocations: 0 }),
      });
      if (res.success && res.data?.url) {
        window.location.href = res.data.url;
      } else {
        setActionError(res.error?.message ?? 'Failed to start checkout');
        setCheckoutLoading(false);
      }
    } catch {
      setActionError('Network error');
      setCheckoutLoading(false);
    }
  };

  const openPortal = async () => {
    setPortalLoading(true);
    setActionError('');
    try {
      const res = await apiFetch<{ success: boolean; data: { url: string } }>('/billing/portal', { method: 'POST' });
      if (res.success && res.data?.url) window.location.href = res.data.url;
    } catch {
      setActionError('Network error');
    } finally {
      setPortalLoading(false);
    }
  };

  if (isLoading || !billing) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-24 bg-slate-100 rounded-xl" />
        <div className="h-32 bg-slate-100 rounded-xl" />
      </div>
    );
  }

  const isTrialing = billing.status === 'trialing';
  const isActive = billing.status === 'active';
  const isPastDue = billing.status === 'past_due';
  const isCanceled = billing.status === 'canceled';
  const needsSubscription = !isActive && !isTrialing;
  const extraLocations = Math.max(0, billing.locationCount - billing.locationsLimit);

  const STATUS_LABELS: Record<string, { label: string; cls: string }> = {
    active:    { label: 'Active', cls: 'bg-green-100 text-green-700' },
    trialing:  { label: 'Trial', cls: 'bg-blue-100 text-blue-700' },
    past_due:  { label: 'Past due', cls: 'bg-amber-100 text-amber-700' },
    canceled:  { label: 'Canceled', cls: 'bg-gray-100 text-gray-500' },
  };
  const statusInfo = STATUS_LABELS[billing.status] ?? { label: billing.status, cls: 'bg-gray-100 text-gray-500' };

  return (
    <div className="space-y-5">
      {actionError && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{actionError}</div>
      )}

      {/* Current plan card */}
      <div className="border border-slate-200 rounded-xl p-5 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs text-slate-500 uppercase tracking-wide font-medium mb-1">Current plan</p>
            <div className="flex items-baseline gap-1.5">
              <span className="text-3xl font-bold text-slate-900">$349</span>
              <span className="text-slate-500 text-sm">/mo</span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">+ $499 setup · $125/mo per extra location</p>
          </div>
          <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${statusInfo.cls}`}>
            {statusInfo.label}
          </span>
        </div>

        {/* Trial countdown */}
        {isTrialing && billing.trialDaysLeft !== null && (
          <div className={`rounded-lg px-4 py-3 text-sm ${billing.trialDaysLeft <= 2 ? 'bg-red-50 text-red-800 border border-red-200' : 'bg-amber-50 text-amber-800 border border-amber-200'}`}>
            {billing.trialDaysLeft === 0
              ? 'Your trial has expired. Subscribe to continue using SuperLocalSEO.'
              : `Trial ends in ${billing.trialDaysLeft} day${billing.trialDaysLeft === 1 ? '' : 's'}.`}
            {billing.trialEndsAt && billing.trialDaysLeft > 0 && (
              <span className="text-xs ml-1 opacity-70">({new Date(billing.trialEndsAt).toLocaleDateString()})</span>
            )}
          </div>
        )}

        {/* Past due warning */}
        {isPastDue && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-800">
            <strong>Payment overdue.</strong> Update your payment method to restore full access.
          </div>
        )}

        {/* Locations section */}
        <div className="pt-1 border-t border-slate-100 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-slate-700">Locations</p>
              <p className="text-xs text-slate-400 mt-0.5">
                {billing.locationCount} / {billing.locationsLimit} included
                {extraLocations > 0 && <span className="text-amber-600 ml-1"> · {extraLocations} extra (+${extraLocations * 125}/mo)</span>}
              </p>
            </div>
            {isAdmin && !showAddLoc && (
              <button
                onClick={() => setShowAddLoc(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50 transition-colors"
              >
                <Plus size={13} /> Add location
              </button>
            )}
          </div>

          {/* Current locations list */}
          {locations.length > 0 && (
            <div className="space-y-1.5">
              {locations.map((loc) => (
                <div key={loc.id} className="flex items-center justify-between px-3 py-2 bg-slate-50 rounded-lg">
                  <div>
                    <p className="text-sm font-medium text-slate-700">{loc.name}</p>
                    {loc.address && <p className="text-xs text-slate-400">{[loc.address, loc.city, loc.state].filter(Boolean).join(', ')}</p>}
                  </div>
                  <button
                    onClick={() => onGoToLocations()}
                    className="text-xs text-brand-500 hover:underline shrink-0 ml-3"
                  >
                    Manage →
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Add location inline form */}
          {showAddLoc && isAdmin && (
            <div className="border border-brand-200 bg-brand-50/30 rounded-xl p-4 space-y-3">
              {billing.locationCount >= billing.locationsLimit && (
                <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-700">
                  <AlertCircle size={13} className="mt-0.5 shrink-0" />
                  <span>
                    You've used all {billing.locationsLimit} included location{billing.locationsLimit !== 1 ? 's' : ''}. Adding another will be billed at an additional <strong>$125/mo</strong>, charged immediately on a prorated basis.
                  </span>
                </div>
              )}
              <p className="text-sm font-medium text-slate-700">New location</p>
              <LocationForm
                initial={EMPTY_LOC_FORM}
                onSave={(form) => void handleAddLocation(form)}
                onCancel={() => { setShowAddLoc(false); setAddLocError(null); }}
                saving={addLocSaving}
                error={addLocError}
              />
            </div>
          )}
        </div>

        {/* Action buttons */}
        {needsSubscription ? (
          <button
            onClick={() => void startCheckout()}
            disabled={checkoutLoading}
            className="w-full py-2.5 rounded-lg text-sm font-semibold bg-brand-500 text-white hover:bg-brand-600 disabled:opacity-50 flex items-center justify-center gap-2 transition-colors"
          >
            {checkoutLoading && <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
            {isCanceled ? 'Reactivate subscription' : 'Subscribe now'}
          </button>
        ) : (
          <button
            onClick={() => void openPortal()}
            disabled={portalLoading}
            className="text-sm font-medium text-brand-500 hover:text-brand-700 disabled:opacity-50"
          >
            {portalLoading ? 'Redirecting…' : 'Manage payment & invoices →'}
          </button>
        )}

        {billing.currentPeriodEnd && isActive && (
          <p className="text-xs text-slate-400">
            Next billing date: {new Date(billing.currentPeriodEnd).toLocaleDateString()}
          </p>
        )}
      </div>

      {/* White-label report branding — operator admin only */}
      {isPlatformAdmin && <WhiteLabelSection />}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function Settings() {
  const [searchParams] = useSearchParams();
  const defaultTab = (searchParams.get('tab') as Tab | null) ?? 'account';
  const [activeTab, setActiveTab] = useState<Tab>(defaultTab);
  const { data, isLoading, error, mutate } = useSWR<ClientResponse>('/clients', fetcher);
  const client = data?.data;
  const { data: teamData } = useSWR<{ success: boolean; data: { owner: { userId: string } | null; members: Array<{ userId: string | null; role: string; accepted: boolean }> } }>('/team', fetcher);
  const { userId, role: platformRole } = useAuth();
  const isPlatformAdmin = platformRole === 'admin'; // JWT role='admin' = operator-level admin account
  const isOwner = !!(teamData?.data?.owner?.userId && teamData.data.owner.userId === userId);
  const currentMember = teamData?.data?.members?.find((m) => m.userId === userId && m.accepted);
  const isAdmin = isOwner || currentMember?.role === 'admin';

  // Account form state
  const [businessName, setBusinessName] = useState('');
  const [industry, setIndustry] = useState('');
  const [accountSaving, setAccountSaving] = useState(false);
  const [accountSuccess, setAccountSuccess] = useState(false);

  const resolvedBusinessName = businessName || client?.businessName || '';
  const resolvedIndustry = industry || client?.industry || '';

  const saveAccount = async () => {
    setAccountSaving(true);
    setAccountSuccess(false);
    try {
      await apiFetch('/clients', {
        method: 'PATCH',
        body: JSON.stringify({ businessName: resolvedBusinessName, industry: resolvedIndustry }),
      });
      await mutate();
      setAccountSuccess(true);
      setTimeout(() => setAccountSuccess(false), 3000);
    } finally {
      setAccountSaving(false);
    }
  };

  const connectGoogle = async () => {
    const res = await apiFetch<{ success: boolean; data: { url: string } }>('/integrations/google/auth-url');
    if (res.success && res.data?.url) window.location.href = res.data.url;
  };

  const disconnectGoogle = async () => {
    await apiFetch('/integrations/google', { method: 'DELETE' });
    await mutate();
  };

  const connectFacebook = async () => {
    const res = await apiFetch<{ success: boolean; data: { url: string } }>('/integrations/facebook/auth-url');
    if (res.success && res.data?.url) window.location.href = res.data.url;
  };

  const disconnectFacebook = async () => {
    await apiFetch('/integrations/facebook', { method: 'DELETE' });
    await mutate();
  };

  if (error) {
    return (
      <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
        Failed to load settings. Please refresh.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900 tracking-tight">Settings</h1>
        <p className="text-sm text-slate-500 mt-1">Manage your account, integrations, and billing</p>
      </div>

      <div className="bg-white rounded-xl shadow-card p-6">
        <TabBar active={activeTab} onChange={setActiveTab} isOwner={isAdmin} />

        {/* Locations tab */}
        {activeTab === 'locations' && <LocationsTab isAdmin={isAdmin} />}

        {/* Keywords tab */}
        {activeTab === 'keywords' && <KeywordsTab isAdmin={isAdmin} />}

        {/* Account tab */}
        {activeTab === 'account' && (
          <div className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Email</label>
              <input
                type="email"
                value={client?.email ?? ''}
                readOnly
                className="w-full border border-slate-200 bg-slate-50 rounded-lg px-3 py-2 text-sm text-slate-500 cursor-not-allowed"
              />
              <p className="mt-1 text-xs text-slate-400">Email cannot be changed here.</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Business Name</label>
              {isLoading ? (
                <div className="h-9 bg-slate-200 rounded-lg animate-pulse" />
              ) : (
                <input
                  type="text"
                  value={resolvedBusinessName}
                  onChange={(e) => setBusinessName(e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Industry</label>
              {isLoading ? (
                <div className="h-9 bg-slate-200 rounded-lg animate-pulse" />
              ) : (
                <select
                  value={resolvedIndustry}
                  onChange={(e) => setIndustry(e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                >
                  <option value="">Select industry</option>
                  {INDUSTRY_GROUPS.map(({ group, options }) => (
                    <optgroup key={group} label={group}>
                      {options.map((ind) => <option key={ind} value={ind}>{ind}</option>)}
                    </optgroup>
                  ))}
                </select>
              )}
            </div>
            {isAdmin && (
              <div className="flex items-center gap-3 pt-2">
                <button
                  onClick={() => void saveAccount()}
                  disabled={accountSaving || isLoading}
                  className="bg-brand-500 text-white px-5 py-2.5 rounded-lg text-sm font-semibold hover:bg-brand-600 disabled:opacity-50"
                >
                  {accountSaving ? 'Saving...' : 'Save changes'}
                </button>
                {accountSuccess && (
                  <span className="text-sm text-green-600 font-medium">Saved!</span>
                )}
              </div>
            )}
            <RoiSettingsSection />
          </div>
        )}

        {/* Integrations tab */}
        {activeTab === 'integrations' && (
          <div className="space-y-4">
            {/* EMR credentials — operator admin only */}
            {isPlatformAdmin && <EMRCredentialsCard />}
            <OAuthCard
              name="Google Business Profile"
              description="Sync reviews, Q&A, and business info from Google"
              connected={client?.integrations?.google?.connected ?? false}
              onConnect={connectGoogle}
              onDisconnect={disconnectGoogle}
            />
            <OAuthCard
              name="Facebook"
              description={
                client?.integrations?.facebook?.pageName
                  ? `Connected to page: ${client.integrations.facebook.pageName}`
                  : 'Sync Facebook page ratings and reviews'
              }
              connected={client?.integrations?.facebook?.connected ?? false}
              // FACEBOOK_APP_ID/SECRET are not provisioned yet, so /integrations/facebook/auth-url
              // returns 503. Show "Coming soon" instead of letting users hit a raw error.
              // Remove comingSoon once the Facebook app credentials are set in the API env.
              comingSoon
              onConnect={connectFacebook}
              onDisconnect={disconnectFacebook}
            />
          </div>
        )}

        {/* Widgets tab */}
        {activeTab === 'widgets' && <WidgetTab />}

        {/* QR Codes tab */}
        {activeTab === 'qrcodes' && <QRTab />}

        {/* Team tab */}
        {activeTab === 'team' && <TeamTab />}

        {/* Billing tab */}
        {activeTab === 'billing' && <BillingTab onGoToLocations={() => setActiveTab('locations')} isAdmin={isAdmin} isPlatformAdmin={isPlatformAdmin} />}
      </div>
    </div>
  );
}
