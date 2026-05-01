import { useState, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import useSWR, { mutate as swrMutate } from 'swr';
import { QrCode, Download, Trash2, Plus, AlertCircle, CheckCircle2, ExternalLink, ChevronDown, ChevronUp } from 'lucide-react';
import { apiFetch, fetcher } from '../services/api';
import { useAuth } from '../hooks/useAuth';

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

const INDUSTRIES = ['Plumbing', 'HVAC', 'Electrical', 'Landscaping', 'Cleaning', 'Other'];
type Tab = 'account' | 'integrations' | 'billing' | 'team' | 'widgets' | 'qrcodes';

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
  const tabs: { key: Tab; label: string }[] = [
    { key: 'account', label: 'Account' },
    { key: 'integrations', label: 'Integrations' },
    { key: 'billing', label: 'Billing' },
    ...(isOwner ? [{ key: 'team' as Tab, label: 'Team' }] : []),
    { key: 'widgets' as Tab, label: 'Widgets' },
    { key: 'qrcodes' as Tab, label: 'QR Codes' },
  ];
  return (
    <div className="flex gap-1 border-b border-gray-200 mb-6">
      {tabs.map((t) => (
        <button
          key={t.key}
          onClick={() => onChange(t.key)}
          className={`px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px ${
            active === t.key
              ? 'border-brand-500 text-brand-500'
              : 'border-transparent text-gray-500 hover:text-gray-900'
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
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
    <div className="border border-gray-200 rounded-xl p-5">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">{name}</h3>
          <p className="text-xs text-gray-500 mt-0.5">{description}</p>
        </div>
        {comingSoon ? (
          <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-400">Coming soon</span>
        ) : (
          <span
            className={`text-xs font-medium px-2 py-0.5 rounded-full ${
              connected ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
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
        className="flex items-center gap-2 text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors"
      >
        {open ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
        Advanced settings
      </button>
      {open && (
        <div className="mt-4 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Only show reviews rated ★ or higher</label>
              <select
                value={cfg.minRating ?? 1}
                onChange={(e) => setDraft((d) => ({ ...d, minRating: Number(e.target.value) }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              >
                <option value={1}>1★ (all)</option>
                <option value={2}>2★</option>
                <option value={3}>3★</option>
                <option value={4}>4★</option>
                <option value={5}>5★ only</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Sort By</label>
              <select
                value={cfg.sortBy ?? 'newest'}
                onChange={(e) => setDraft((d) => ({ ...d, sortBy: e.target.value as WidgetAdvancedConfig['sortBy'] }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              >
                <option value="newest">Newest</option>
                <option value="highest">Highest rated</option>
                <option value="lowest">Lowest rated</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Max Reviews</label>
              <input
                type="number"
                min={1}
                max={50}
                value={cfg.reviewCount ?? 10}
                onChange={(e) => setDraft((d) => ({ ...d, reviewCount: Number(e.target.value) }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-2">Platform Filter</label>
            <div className="flex flex-wrap gap-3">
              {ALL_PLATFORMS.map((p) => (
                <label key={p} className="flex items-center gap-1.5 text-sm text-gray-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={activePlatforms.includes(p.toLowerCase())}
                    onChange={() => togglePlatform(p)}
                    className="rounded border-gray-300 text-brand-500 focus:ring-brand-500"
                  />
                  {p}
                </label>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Custom CSS</label>
            <textarea
              value={cfg.customCss ?? ''}
              onChange={(e) => setDraft((d) => ({ ...d, customCss: e.target.value }))}
              placeholder=".emr-widget { ... }"
              rows={4}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-brand-500 resize-none"
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

  if (!widget) return <div className="space-y-3 animate-pulse">{[...Array(3)].map((_, i) => <div key={i} className="h-10 bg-gray-100 rounded-lg" />)}</div>;

  return (
    <div className="space-y-6">
      {/* Embed code */}
      <div>
        <h3 className="text-sm font-semibold text-gray-900 mb-2">Embed code</h3>
        <p className="text-xs text-gray-500 mb-3">Paste this snippet anywhere on your website to show your reviews.</p>
        <div className="relative">
          <pre className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-xs text-gray-700 overflow-x-auto whitespace-pre-wrap font-mono">{embedSnippet}</pre>
          <button
            onClick={() => void copyEmbed()}
            className="absolute top-2 right-2 px-2.5 py-1 bg-white border border-gray-200 rounded text-xs font-medium text-gray-600 hover:bg-gray-50"
          >
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>
      </div>

      {/* Config */}
      <div className="border-t pt-5">
        <h3 className="text-sm font-semibold text-gray-900 mb-4">Appearance</h3>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Theme</label>
            <select
              value={cfg.theme ?? 'light'}
              onChange={(e) => setConfig((c) => ({ ...c, theme: e.target.value as 'light' | 'dark' }))}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            >
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Reviews to show</label>
            <select
              value={cfg.maxCount ?? 8}
              onChange={(e) => setConfig((c) => ({ ...c, maxCount: Number(e.target.value) }))}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            >
              <option value={6}>6</option>
              <option value={8}>8</option>
              <option value={10}>10</option>
              <option value={20}>20</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Minimum rating</label>
            <select
              value={cfg.minRating ?? 4}
              onChange={(e) => setConfig((c) => ({ ...c, minRating: Number(e.target.value) }))}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
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
              className="rounded border-gray-300 text-brand-500 focus:ring-brand-500"
            />
            <label htmlFor="showPlatformBadge" className="text-sm text-gray-700">Show platform badge</label>
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
            className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50"
          >
            {showPreview ? 'Hide preview' : 'Preview widget'}
          </button>
        </div>
      </div>

      {/* Live preview */}
      {showPreview && (
        <div className="border-t pt-5">
          <h3 className="text-sm font-semibold text-gray-900 mb-3">Live preview</h3>
          <p className="text-xs text-gray-500 mb-3">Reflects your current settings before saving.</p>
          <WidgetPreview widgetKey={key} cfg={cfg} />
        </div>
      )}

      {/* Advanced settings */}
      {widget.id && <WidgetAdvancedPanel widgetId={widget.id} />}

      {/* Danger zone */}
      <div className="border-t pt-5">
        <h3 className="text-sm font-semibold text-gray-900 mb-1">Regenerate widget key</h3>
        <p className="text-xs text-gray-500 mb-3">This invalidates your current embed. You'll need to update the snippet on your website.</p>
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
        <p className="text-sm text-gray-500">Generate printable QR codes that link customers directly to your Google review page. Scans are tracked automatically.</p>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="flex items-center gap-2 px-3 py-2 bg-brand-500 text-white text-sm font-medium rounded-lg hover:bg-brand-600 transition-colors"
        >
          <Plus size={14} /> New QR code
        </button>
      </div>

      {showForm && (
        <form onSubmit={(e) => void handleCreate(e)} className="border border-gray-200 rounded-xl p-5 bg-gray-50 space-y-4">
          <h4 className="font-medium text-gray-800">Create QR code</h4>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Name *</label>
              <input
                required
                value={form.name}
                onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                placeholder="Front desk card"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 bg-white"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Location (optional)</label>
              <select
                value={form.locationId}
                onChange={(e) => handleLocationChange(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 bg-white"
              >
                <option value="">— None —</option>
                {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Target URL (Google review link) *</label>
            <input
              required
              type="url"
              value={form.targetUrl}
              onChange={(e) => setForm((p) => ({ ...p, targetUrl: e.target.value }))}
              placeholder="https://search.google.com/local/writereview?placeid=…"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand-500 bg-white"
            />
            <p className="text-xs text-gray-400 mt-1">
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
            <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900">Cancel</button>
            <button type="submit" disabled={saving} className="px-4 py-2 bg-brand-500 text-white text-sm font-medium rounded-lg hover:bg-brand-600 disabled:opacity-50 transition-colors">
              {saving ? 'Creating…' : 'Create'}
            </button>
          </div>
        </form>
      )}

      {isLoading && (
        <div className="space-y-3">
          {[1, 2].map((n) => <div key={n} className="h-20 bg-gray-100 rounded-xl animate-pulse" />)}
        </div>
      )}

      {!isLoading && qrCodes.length === 0 && !showForm && (
        <div className="border-2 border-dashed border-gray-200 rounded-xl py-12 text-center">
          <QrCode size={36} className="mx-auto text-gray-300 mb-3" />
          <p className="text-sm text-gray-500 font-medium">No QR codes yet</p>
          <p className="text-xs text-gray-400 mt-1">Create one to start directing customers to your review page</p>
        </div>
      )}

      {qrCodes.length > 0 && (
        <div className="space-y-3">
          {qrCodes.map((qr) => (
            <div key={qr.id} className="flex items-center gap-4 border border-gray-200 rounded-xl px-5 py-4 bg-white">
              <img
                ref={imgRef}
                src={`/api/qr/${qr.id}/image.png`}
                alt={`QR code for ${qr.name}`}
                className="w-14 h-14 rounded border border-gray-100"
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-gray-800">{qr.name}</span>
                  {qr.locationName && <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">{qr.locationName}</span>}
                </div>
                <a href={qr.targetUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-brand-500 hover:underline flex items-center gap-1 mt-0.5 truncate">
                  <ExternalLink size={10} /> {qr.targetUrl.length > 50 ? `${qr.targetUrl.slice(0, 50)}…` : qr.targetUrl}
                </a>
                <p className="text-xs text-gray-400 mt-0.5">
                  {qr.scanCount.toLocaleString()} scan{qr.scanCount !== 1 ? 's' : ''}
                  {qr.lastScannedAt && ` · last ${new Date(qr.lastScannedAt).toLocaleDateString()}`}
                </p>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => downloadImage(qr.id, qr.name)}
                  title="Download PNG"
                  className="p-1.5 rounded-lg text-gray-400 hover:text-brand-500 hover:bg-gray-100 transition-colors"
                >
                  <Download size={15} />
                </button>
                <button
                  onClick={() => void handleDelete(qr.id, qr.name)}
                  title="Delete"
                  className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"
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
    return <div className="space-y-3 animate-pulse">{[...Array(3)].map((_, i) => <div key={i} className="h-12 bg-gray-100 rounded-lg" />)}</div>;
  }

  return (
    <div className="space-y-6">
      {/* Member list */}
      <div className="space-y-2">
        {team?.owner && (
          <div className="flex items-center justify-between py-3 px-4 bg-gray-50 rounded-lg">
            <div>
              <p className="text-sm font-medium text-gray-900">{team.owner.email}</p>
              <p className="text-xs text-gray-400">Account owner</p>
            </div>
            <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-brand-100 text-brand-700">Owner</span>
          </div>
        )}
        {team?.members.map((m) => (
          <div key={m.id} className="flex items-center justify-between py-3 px-4 border border-gray-200 rounded-lg">
            <div>
              <p className="text-sm font-medium text-gray-900">{m.email}</p>
              <p className="text-xs text-gray-400">
                {m.accepted ? 'Active' : m.expired ? 'Invite expired' : 'Invite pending'}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 capitalize">{m.role}</span>
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
          <p className="text-sm text-gray-400 text-center py-4">No team members yet.</p>
        )}
      </div>

      {/* Invite form */}
      <div className="border-t pt-5">
        <h3 className="text-sm font-semibold text-gray-900 mb-3">Invite team member</h3>
        <div className="flex gap-2">
          <input
            type="email"
            placeholder="email@example.com"
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
            className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
          <select
            value={inviteRole}
            onChange={(e) => setInviteRole(e.target.value as 'admin' | 'viewer')}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
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
        <p className="mt-2 text-xs text-gray-400">Admins can manage locations and keywords. Viewers have read-only access.</p>
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
      <h3 className="text-sm font-semibold text-gray-900 mb-1">ROI Settings</h3>
      <p className="text-xs text-gray-500 mb-4">Used to estimate monthly revenue value from your keyword rankings.</p>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Average Customer Value ($)</label>
          <input
            type="number"
            min={0}
            value={resolvedAcv}
            onChange={(e) => setAcv(e.target.value)}
            placeholder="500"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Conversion Rate (%)</label>
          <input
            type="number"
            min={0}
            max={100}
            step={0.1}
            value={resolvedConv}
            onChange={(e) => setConv(e.target.value)}
            placeholder="3"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>
      </div>
      <p className="mt-3 text-xs text-gray-400">
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

// ─── Billing tab ─────────────────────────────────────────────────────────────

interface BillingStatus {
  tier: number | null;
  status: string | null;
  currentPeriodEnd: string | null;
  locationCount: number;
  hasPaymentMethod: boolean;
  paymentFailedAt: string | null;
  graceDaysRemaining: number | null;
}

interface BillingResponse {
  success: boolean;
  data: BillingStatus;
}

const PLANS = [
  { tier: 1 as const, name: 'Starter', price: '$350', features: ['1 location', 'Rank tracking', 'Review management', 'Citation builder'] },
  { tier: 2 as const, name: 'Growth', price: '$700', features: ['Up to 3 locations', 'Everything in Starter', 'Geo-grid reports', 'Competitor tracking'] },
  { tier: 3 as const, name: 'Pro', price: '$1,200', features: ['Unlimited locations', 'Everything in Growth', 'White-label reports', 'Priority support'] },
];

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
      <h3 className="text-sm font-semibold text-gray-900 mb-1">White-Label Reports</h3>
      <p className="text-xs text-gray-500 mb-4">Customize the branding on your monthly PDF reports. Leave blank to use SuperLocalSEO defaults.</p>
      <div className="space-y-3">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Company Name</label>
          <input
            type="text"
            value={resolvedName}
            onChange={(e) => setCompanyName(e.target.value)}
            placeholder="Your Agency Name"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Logo URL</label>
          <input
            type="url"
            value={resolvedLogo}
            onChange={(e) => setLogoUrl(e.target.value)}
            placeholder="https://yoursite.com/logo.png"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
          <p className="text-xs text-gray-400 mt-1">PNG or SVG, publicly accessible. Will appear in the report header.</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex-1">
            <label className="block text-xs font-medium text-gray-600 mb-1">Brand Color</label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={resolvedColor}
                onChange={(e) => setColor(e.target.value)}
                className="h-9 w-14 border border-gray-300 rounded-lg cursor-pointer p-0.5"
              />
              <input
                type="text"
                value={resolvedColor}
                onChange={(e) => setColor(e.target.value)}
                placeholder="#0052CC"
                className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand-500"
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

function BillingTab() {
  const { data, isLoading, mutate: mutateBilling } = useSWR<BillingResponse>('/billing', fetcher);
  const billing = data?.data;
  const [changing, setChanging] = useState<number | null>(null);
  const [changeError, setChangeError] = useState('');
  const [portalLoading, setPortalLoading] = useState(false);
  const [checkoutLoading, setCheckoutLoading] = useState<number | null>(null);

  // Handle post-checkout return
  const [checkoutSuccess] = useState(() => new URLSearchParams(window.location.search).get('checkout') === 'success');

  const openBillingPortal = async () => {
    setPortalLoading(true);
    try {
      const res = await apiFetch<{ success: boolean; data: { url: string } }>('/billing/portal', { method: 'POST' });
      if (res.success && res.data?.url) window.location.href = res.data.url;
    } finally {
      setPortalLoading(false);
    }
  };

  const startCheckout = async (tier: 1 | 2 | 3) => {
    setCheckoutLoading(tier);
    try {
      const res = await apiFetch<{ success: boolean; data: { url: string }; error?: { message: string } }>('/billing/checkout', {
        method: 'POST',
        body: JSON.stringify({ tier }),
      });
      if (res.success && res.data?.url) {
        window.location.href = res.data.url;
      } else {
        setChangeError((res as { error?: { message: string } }).error?.message ?? 'Failed to start checkout');
      }
    } catch {
      setChangeError('Network error');
    } finally {
      setCheckoutLoading(null);
    }
  };

  const changePlan = async (tier: 1 | 2 | 3) => {
    setChanging(tier);
    setChangeError('');
    try {
      const res = await apiFetch<{ success: boolean; error?: { message: string } }>('/billing/change-plan', {
        method: 'POST',
        body: JSON.stringify({ tier }),
      });
      if (!res.success) {
        setChangeError((res as { error?: { message: string } }).error?.message ?? 'Failed to change plan');
      } else {
        await mutateBilling();
      }
    } catch {
      setChangeError('Network error');
    } finally {
      setChanging(null);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-5 bg-gray-200 rounded w-40" />
        <div className="grid grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => <div key={i} className="h-48 bg-gray-100 rounded-xl" />)}
        </div>
      </div>
    );
  }

  const currentTier = billing?.tier;
  const isActive = billing?.status === 'active';
  const isPastDue = billing?.status === 'past_due';
  const hasSub = !!(billing?.status && billing.status !== 'canceled' && currentTier);

  return (
    <div className="space-y-5">
      {/* Post-checkout success */}
      {checkoutSuccess && (
        <div className="p-4 bg-green-50 border border-green-200 rounded-lg text-sm text-green-800">
          <strong>Subscription activated!</strong> Welcome aboard. Your plan is now active.
        </div>
      )}

      {/* Past due warning */}
      {isPastDue && (
        <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
          <strong>Payment overdue.</strong>{' '}
          {billing?.graceDaysRemaining != null && billing.graceDaysRemaining > 0
            ? `You have ${billing.graceDaysRemaining} day${billing.graceDaysRemaining !== 1 ? 's' : ''} remaining before access is restricted.`
            : 'Access will be restricted until payment is resolved.'}
          {' '}
          <button onClick={() => void openBillingPortal()} className="underline font-medium">Update payment method</button>
        </div>
      )}

      {changeError && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{changeError}</div>
      )}

      {/* Plan cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {PLANS.map((plan) => {
          const isCurrent = currentTier === plan.tier;
          const isUpgrade = hasSub && currentTier != null && plan.tier > currentTier;
          const isDowngrade = hasSub && currentTier != null && plan.tier < currentTier;
          return (
            <div
              key={plan.tier}
              className={`border rounded-xl p-5 flex flex-col gap-3 transition-colors ${
                isCurrent ? 'border-brand-500 bg-brand-50' : 'border-gray-200 bg-white'
              }`}
            >
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-semibold text-gray-900">{plan.name}</p>
                  <p className="text-xl font-bold text-gray-900 mt-0.5">{plan.price}<span className="text-sm font-normal text-gray-500">/mo</span></p>
                </div>
                {isCurrent && (
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${isActive ? 'bg-green-100 text-green-700' : isPastDue ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-500'}`}>
                    {isActive ? 'Current' : isPastDue ? 'Past due' : billing?.status ?? 'Current'}
                  </span>
                )}
              </div>
              <ul className="space-y-1.5 flex-1">
                {plan.features.map((f) => (
                  <li key={f} className="flex items-start gap-1.5 text-xs text-gray-600">
                    <span className="text-green-500 mt-0.5">✓</span> {f}
                  </li>
                ))}
              </ul>
              {!isCurrent && hasSub && (
                <button
                  onClick={() => void changePlan(plan.tier)}
                  disabled={changing !== null}
                  className={`w-full py-2 px-3 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 ${
                    isUpgrade
                      ? 'bg-brand-500 text-white hover:bg-brand-600'
                      : 'border border-gray-300 text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  {changing === plan.tier ? 'Changing…' : isUpgrade ? 'Upgrade' : isDowngrade ? 'Downgrade' : 'Switch'}
                </button>
              )}
              {!isCurrent && !hasSub && (
                <button
                  onClick={() => void startCheckout(plan.tier)}
                  disabled={checkoutLoading !== null}
                  className="w-full py-2 px-3 rounded-lg text-sm font-medium bg-brand-500 text-white hover:bg-brand-600 disabled:opacity-50 transition-colors"
                >
                  {checkoutLoading === plan.tier ? 'Redirecting…' : 'Subscribe'}
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* Portal link for payment / invoice management */}
      <div className="pt-1 border-t">
        <button
          onClick={() => void openBillingPortal()}
          disabled={portalLoading}
          className="text-sm font-medium text-brand-500 hover:text-brand-700 disabled:opacity-50"
        >
          {portalLoading ? 'Redirecting…' : 'Manage payment method & invoices →'}
        </button>
        {billing?.currentPeriodEnd && (
          <p className="text-xs text-gray-400 mt-1">
            Current period ends {new Date(billing.currentPeriodEnd).toLocaleDateString()}
          </p>
        )}
      </div>

      {/* White-label report branding — Pro only */}
      {currentTier === 3 && <WhiteLabelSection />}
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
  const { data: teamData } = useSWR<{ success: boolean; data: { owner: { userId: string } | null } }>('/team', fetcher);
  const { userId } = useAuth();
  const isOwner = !!(teamData?.data?.owner?.userId && teamData.data.owner.userId === userId);

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
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
        <p className="text-sm text-gray-500 mt-1">Manage your account, integrations, and billing</p>
      </div>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
        <TabBar active={activeTab} onChange={setActiveTab} isOwner={isOwner} />

        {/* Account tab */}
        {activeTab === 'account' && (
          <div className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
              <input
                type="email"
                value={client?.email ?? ''}
                readOnly
                className="w-full border border-gray-200 bg-gray-50 rounded-lg px-3 py-2 text-sm text-gray-500 cursor-not-allowed"
              />
              <p className="mt-1 text-xs text-gray-400">Email cannot be changed here.</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Business Name</label>
              {isLoading ? (
                <div className="h-9 bg-gray-200 rounded-lg animate-pulse" />
              ) : (
                <input
                  type="text"
                  value={resolvedBusinessName}
                  onChange={(e) => setBusinessName(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Industry</label>
              {isLoading ? (
                <div className="h-9 bg-gray-200 rounded-lg animate-pulse" />
              ) : (
                <select
                  value={resolvedIndustry}
                  onChange={(e) => setIndustry(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                >
                  <option value="">Select industry</option>
                  {INDUSTRIES.map((ind) => <option key={ind} value={ind}>{ind}</option>)}
                </select>
              )}
            </div>
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
            <RoiSettingsSection />
          </div>
        )}

        {/* Integrations tab */}
        {activeTab === 'integrations' && (
          <div className="space-y-4">
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
              onConnect={connectFacebook}
              onDisconnect={disconnectFacebook}
            />
            <div className="border border-gray-200 rounded-xl p-5">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-gray-900">Yelp</h3>
                  <p className="text-xs text-gray-500 mt-0.5">Yelp review monitoring via reputation tracking</p>
                </div>
                <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-blue-50 text-blue-600">Via BrightLocal</span>
              </div>
              <p className="mt-3 text-xs text-gray-500 leading-relaxed">
                Yelp reviews are monitored automatically through your BrightLocal reputation campaign. Yelp removed direct API access in 2018 — BrightLocal&apos;s reputation monitoring is the reliable way to track them.
              </p>
            </div>
          </div>
        )}

        {/* Widgets tab */}
        {activeTab === 'widgets' && <WidgetTab />}

        {/* QR Codes tab */}
        {activeTab === 'qrcodes' && <QRTab />}

        {/* Team tab */}
        {activeTab === 'team' && <TeamTab />}

        {/* Billing tab */}
        {activeTab === 'billing' && <BillingTab />}
      </div>
    </div>
  );
}
