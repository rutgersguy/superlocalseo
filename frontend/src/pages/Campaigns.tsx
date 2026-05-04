import { useState, useRef } from 'react';
import useSWR, { useSWRConfig } from 'swr';
import { Mail, Upload, Send, ChevronDown, ChevronUp, AlertCircle, CheckCircle2, UserX, Plus, X } from 'lucide-react';
import { fetcher, apiFetch } from '../services/api';

interface Campaign {
  id: string;
  emrCampaignId: string;
  name: string;
  invited: number;
  opened: number;
  clicked: number;
  reviewed: number;
  privateFeedback: number;
  unsubscribed: number;
  metricsPulledAt: string | null;
}

interface CampaignsResponse {
  success: boolean;
  data: { campaigns: Campaign[] };
}

interface Unsubscribe {
  contact: string;
  type: 'email' | 'sms';
  unsubscribedAt: string;
}

interface UnsubscribesResponse {
  success: boolean;
  data: { unsubscribes: Unsubscribe[]; total: number; hasMore: boolean };
}

interface CreditsResponse {
  success: boolean;
  data: { email: number; sms: number; total: number; connected: boolean; available: boolean };
}

interface TemplatesResponse {
  success: boolean;
  data: { templates: Array<{ id: string; name: string; description: string; type: string }> };
}

// ── Credit badge ────────────────────────────────────────────────────────────

function CreditBadge() {
  const { data } = useSWR<CreditsResponse>('/campaigns/credits', fetcher, { refreshInterval: 60_000 });
  const credits = data?.data;
  if (!credits?.available) return null;

  const isLow = credits.total < 50;
  const isCritical = credits.total < 20;

  return (
    <div className={`flex items-center gap-3 text-sm px-3 py-1.5 rounded-lg border ${
      isCritical ? 'bg-red-50 border-red-200 text-red-700' :
      isLow ? 'bg-amber-50 border-amber-200 text-amber-700' :
      'bg-slate-50 border-slate-200 text-slate-600'
    }`}>
      <span>📧 {credits.email}</span>
      <span>📱 {credits.sms}</span>
      {isLow && <span className="font-medium">{isCritical ? '⚠ Critical' : '⚠ Low'}</span>}
    </div>
  );
}

// ── Template picker ─────────────────────────────────────────────────────────

function TemplatePicker({ onSelect }: { onSelect: (name: string, id?: string) => void }) {
  const { data, isLoading } = useSWR<TemplatesResponse>('/campaigns/templates', fetcher);
  const templates = data?.data?.templates ?? [];

  if (isLoading) return <div className="text-sm text-slate-400">Loading templates...</div>;

  return (
    <div className="space-y-3">
      <p className="text-sm font-medium text-slate-700">Start from a template</p>
      <div className="grid grid-cols-2 gap-3">
        {templates.map((t) => (
          <button
            key={t.id}
            onClick={() => onSelect(t.name, t.id)}
            className="text-left p-3 border border-slate-200 rounded-lg hover:border-brand-400 hover:bg-brand-50 transition-colors"
          >
            <p className="text-sm font-medium text-slate-900">{t.name}</p>
            {t.description && <p className="text-xs text-slate-500 mt-0.5">{t.description}</p>}
          </button>
        ))}
        <button
          onClick={() => onSelect('', undefined)}
          className="text-left p-3 border border-dashed border-slate-300 rounded-lg hover:border-brand-400 text-sm text-slate-500 hover:text-brand-600"
        >
          Start from scratch
        </button>
      </div>
    </div>
  );
}

// ── New campaign modal ──────────────────────────────────────────────────────

function NewCampaignModal({ onClose }: { onClose: () => void }) {
  const { mutate } = useSWRConfig();
  const { data: templatesData, isLoading: templatesLoading } = useSWR<TemplatesResponse>('/campaigns/templates', fetcher);
  const templates = templatesData?.data?.templates ?? [];
  const [step, setStep] = useState<'pick' | 'name'>('pick');
  const [name, setName] = useState('');
  const [templateId, setTemplateId] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const showPicker = step === 'pick' && (templatesLoading || templates.length > 0);

  function handleTemplateSelect(templateName: string, id?: string) {
    setName(templateName);
    setTemplateId(id);
    setStep('name');
  }

  async function handleCreate() {
    if (!name.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch<{ success: boolean; error?: { message: string } }>('/campaigns', {
        method: 'POST',
        body: JSON.stringify({ name: name.trim(), templateId }),
      });
      if (!res.success) {
        setError(res.error?.message ?? 'Failed to create campaign. Please try again.');
        setLoading(false);
        return;
      }
      await mutate('/campaigns');
      onClose();
    } catch {
      setError('Failed to create campaign. Please try again.');
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <h2 className="font-semibold text-slate-900">New Campaign</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X size={18} />
          </button>
        </div>
        <div className="px-5 py-5 space-y-4">
          {showPicker && (
            <TemplatePicker onSelect={handleTemplateSelect} />
          )}
          {!showPicker && (
            <div className="space-y-4">
              <div>
                <label className="block text-xs text-slate-500 mb-1">Campaign name</label>
                <input
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && name.trim()) void handleCreate(); }}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                  placeholder="e.g. Post-visit review request"
                />
              </div>
              {error && (
                <div className="flex items-center gap-2 text-red-600 text-xs">
                  <AlertCircle size={13} /> {error}
                </div>
              )}
              <div className="flex gap-3">
                {templates.length > 0 && step === 'name' && (
                  <button
                    onClick={() => setStep('pick')}
                    disabled={loading}
                    className="px-4 py-2 text-sm font-medium text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-50 transition-colors"
                  >
                    Back
                  </button>
                )}
                <button
                  onClick={() => void handleCreate()}
                  disabled={loading || !name.trim()}
                  className="flex-1 px-4 py-2 bg-brand-500 text-white text-sm font-medium rounded-lg hover:bg-brand-600 disabled:opacity-50 transition-colors"
                >
                  {loading ? 'Creating…' : 'Create Campaign'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Funnel bar ─────────────────────────────────────────────────────────────

function FunnelBar({ label, value, base, color }: { label: string; value: number; base: number; color: string }) {
  const pct = base > 0 ? Math.round((value / base) * 100) : 0;
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="w-28 text-slate-500 text-xs truncate">{label}</span>
      <div className="flex-1 bg-slate-100 rounded-full h-2">
        <div className={`h-2 rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="w-12 text-right font-medium text-slate-700">{value.toLocaleString()}</span>
      <span className="w-8 text-right text-slate-400 text-xs">{pct}%</span>
    </div>
  );
}

// ── Single invite form ──────────────────────────────────────────────────────

function InviteForm({ campaignId, onSent }: { campaignId: string; onSent: () => void }) {
  const [form, setForm] = useState({ firstName: '', lastName: '', email: '', phone: '' });
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.email && !form.phone) {
      setResult('error:Email or phone required');
      return;
    }
    setLoading(true);
    setResult(null);
    try {
      const res = await apiFetch<{ success: boolean; data: { sent: number } }>(
        `/campaigns/${campaignId}/invite`,
        { method: 'POST', body: JSON.stringify({ ...form, lastName: form.lastName || undefined, email: form.email || undefined, phone: form.phone || undefined }) },
      );
      if (res.success) {
        setResult('ok');
        setForm({ firstName: '', lastName: '', email: '', phone: '' });
        onSent();
      } else {
        setResult('error:Failed to send invite');
      }
    } catch {
      setResult('error:Network error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-slate-500 mb-1">First name *</label>
          <input
            required
            value={form.firstName}
            onChange={(e) => setForm((p) => ({ ...p, firstName: e.target.value }))}
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            placeholder="Jane"
          />
        </div>
        <div>
          <label className="block text-xs text-slate-500 mb-1">Last name</label>
          <input
            value={form.lastName}
            onChange={(e) => setForm((p) => ({ ...p, lastName: e.target.value }))}
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            placeholder="Smith"
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-slate-500 mb-1">Email</label>
          <input
            type="email"
            value={form.email}
            onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))}
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            placeholder="jane@example.com"
          />
        </div>
        <div>
          <label className="block text-xs text-slate-500 mb-1">Phone</label>
          <input
            type="tel"
            value={form.phone}
            onChange={(e) => setForm((p) => ({ ...p, phone: e.target.value }))}
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            placeholder="+15551234567"
          />
        </div>
      </div>
      {result === 'ok' && (
        <div className="flex items-center gap-2 text-green-700 text-sm">
          <CheckCircle2 size={14} /> Invite sent successfully
        </div>
      )}
      {result?.startsWith('error:') && (
        <div className="flex items-center gap-2 text-red-600 text-sm">
          <AlertCircle size={14} /> {result.slice(6)}
        </div>
      )}
      <button
        type="submit"
        disabled={loading}
        className="flex items-center gap-2 px-4 py-2 bg-brand-500 text-white text-sm font-medium rounded-lg hover:bg-brand-600 disabled:opacity-50 transition-colors"
      >
        <Send size={14} />
        {loading ? 'Sending…' : 'Send invite'}
      </button>
    </form>
  );
}

// ── Bulk upload panel ───────────────────────────────────────────────────────

interface ParsedContact {
  firstName: string;
  lastName?: string;
  email?: string;
  phone?: string;
}

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (const ch of line) {
    if (ch === '"') { inQuotes = !inQuotes; continue; }
    if (ch === ',' && !inQuotes) { result.push(current.trim()); current = ''; continue; }
    current += ch;
  }
  result.push(current.trim());
  return result;
}

function parseCsv(raw: string): ParsedContact[] {
  const lines = raw.trim().split('\n').filter(Boolean);
  if (lines.length < 2) return [];
  const headers = parseCsvLine(lines[0]).map((h) => h.toLowerCase().replace(/\s+/g, '_'));
  return lines.slice(1).flatMap((line) => {
    const cols = parseCsvLine(line);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => { row[h] = cols[i] ?? ''; });
    const firstName = row['first_name'] ?? row['firstname'] ?? row['name'] ?? '';
    if (!firstName) return [];
    return [{
      firstName,
      lastName: row['last_name'] ?? row['lastname'] ?? undefined,
      email: row['email'] ?? undefined,
      phone: row['phone'] ?? row['mobile'] ?? undefined,
    }];
  });
}

function BulkUpload({ campaignId, onSent }: { campaignId: string; onSent: () => void }) {
  const [csv, setCsv] = useState('');
  const [preview, setPreview] = useState<ParsedContact[]>([]);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ sent: number; failed: number } | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function handleCsvChange(raw: string) {
    setCsv(raw);
    setResult(null);
    setParseError(null);
    const parsed = parseCsv(raw);
    if (raw.trim() && parsed.length === 0) {
      setParseError('Could not parse any contacts. Check that your CSV has a header row with first_name/email columns.');
    }
    setPreview(parsed.slice(0, 5));
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => handleCsvChange(evt.target?.result as string ?? '');
    reader.readAsText(file);
  }

  async function handleSend() {
    const contacts = parseCsv(csv);
    if (!contacts.length) return;
    setLoading(true);
    setResult(null);
    try {
      const res = await apiFetch<{ success: boolean; data: { sent: number; failed: number } }>(
        `/campaigns/${campaignId}/invite/bulk`,
        { method: 'POST', body: JSON.stringify({ contacts }) },
      );
      if (res.success) {
        setResult(res.data);
        setCsv('');
        setPreview([]);
        onSent();
      }
    } catch {
      setParseError('Network error');
    } finally {
      setLoading(false);
    }
  }

  const contacts = parseCsv(csv);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="flex items-center gap-2 px-3 py-1.5 border border-slate-200 rounded-lg text-sm text-slate-600 hover:bg-slate-50 transition-colors"
        >
          <Upload size={14} /> Upload CSV
        </button>
        <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={handleFileChange} />
        <span className="text-xs text-slate-400">or paste below</span>
      </div>

      <textarea
        value={csv}
        onChange={(e) => handleCsvChange(e.target.value)}
        rows={5}
        placeholder={'first_name,last_name,email,phone\nJane,Smith,jane@example.com,\nJohn,Doe,,+15551234567'}
        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand-500 resize-y"
      />

      {parseError && (
        <div className="flex items-start gap-2 text-red-600 text-xs">
          <AlertCircle size={13} className="mt-0.5 flex-shrink-0" /> {parseError}
        </div>
      )}

      {preview.length > 0 && (
        <div className="text-xs text-slate-500">
          Preview ({contacts.length} contact{contacts.length !== 1 ? 's' : ''}):
          {preview.map((c, i) => (
            <span key={i} className="ml-1 inline-block bg-slate-100 rounded px-1.5 py-0.5 mr-1">
              {c.firstName} {c.lastName ?? ''} {c.email ? `<${c.email}>` : c.phone ?? ''}
            </span>
          ))}
          {contacts.length > 5 && <span className="text-slate-400">…and {contacts.length - 5} more</span>}
        </div>
      )}

      {result && (
        <div className="flex items-center gap-2 text-sm">
          <CheckCircle2 size={14} className="text-green-600" />
          <span className="text-green-700">Sent {result.sent}</span>
          {result.failed > 0 && <span className="text-red-600">· {result.failed} failed</span>}
        </div>
      )}

      <button
        type="button"
        disabled={loading || contacts.length === 0}
        onClick={() => void handleSend()}
        className="flex items-center gap-2 px-4 py-2 bg-brand-500 text-white text-sm font-medium rounded-lg hover:bg-brand-600 disabled:opacity-50 transition-colors"
      >
        <Send size={14} />
        {loading ? `Sending ${contacts.length}…` : `Send ${contacts.length} invite${contacts.length !== 1 ? 's' : ''}`}
      </button>
    </div>
  );
}

// ── Campaign card ───────────────────────────────────────────────────────────

function CampaignCard({ campaign }: { campaign: Campaign }) {
  const [expanded, setExpanded] = useState(false);
  const [tab, setTab] = useState<'single' | 'bulk'>('single');
  const [inviteCount, setInviteCount] = useState(0);

  const base = campaign.invited || 1;

  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-card overflow-hidden">
      <div
        className="flex items-center justify-between px-5 py-4 cursor-pointer hover:bg-slate-50 transition-colors"
        onClick={() => setExpanded((v) => !v)}
      >
        <div>
          <h3 className="font-semibold text-slate-900">{campaign.name}</h3>
          <p className="text-xs text-slate-400 mt-0.5">
            {campaign.invited.toLocaleString()} invited · {campaign.reviewed.toLocaleString()} reviewed
            {inviteCount > 0 && <span className="ml-2 text-brand-500">+{inviteCount} sent this session</span>}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <div className="text-lg font-bold text-brand-600">
              {campaign.invited > 0 ? Math.round((campaign.reviewed / campaign.invited) * 100) : 0}%
            </div>
            <div className="text-xs text-slate-400">review rate</div>
          </div>
          {expanded ? <ChevronUp size={16} className="text-slate-400" /> : <ChevronDown size={16} className="text-slate-400" />}
        </div>
      </div>

      {expanded && (
        <div className="px-5 pb-5 border-t border-slate-100 space-y-5">
          {/* Funnel */}
          <div className="pt-4 space-y-2">
            <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">Funnel</h4>
            <FunnelBar label="Invited" value={campaign.invited} base={base} color="bg-brand-400" />
            <FunnelBar label="Opened" value={campaign.opened} base={base} color="bg-brand-500" />
            <FunnelBar label="Clicked" value={campaign.clicked} base={base} color="bg-brand-600" />
            <FunnelBar label="Reviewed (public)" value={campaign.reviewed} base={base} color="bg-green-500" />
            <FunnelBar label="Private feedback" value={campaign.privateFeedback} base={base} color="bg-yellow-400" />
            <FunnelBar label="Unsubscribed" value={campaign.unsubscribed} base={base} color="bg-red-300" />
          </div>

          <div className="bg-blue-50 border border-blue-100 rounded-lg px-4 py-3 text-xs text-blue-800">
            <strong>How it works:</strong> EmbedMyReviews routes each recipient based on their experience — happy customers (4-5★) are directed to Google for a public review; less satisfied customers (1-3★) are routed to a private feedback form instead of a public platform.
          </div>

          {/* Send invites */}
          <div>
            <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">Send invites</h4>
            <div className="flex gap-3 mb-4">
              <button
                onClick={() => setTab('single')}
                className={`flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg transition-colors ${tab === 'single' ? 'bg-brand-50 text-brand-700 font-medium' : 'text-slate-500 hover:text-slate-700'}`}
              >
                <Mail size={14} /> Single
              </button>
              <button
                onClick={() => setTab('bulk')}
                className={`flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg transition-colors ${tab === 'bulk' ? 'bg-brand-50 text-brand-700 font-medium' : 'text-slate-500 hover:text-slate-700'}`}
              >
                <Upload size={14} /> Bulk CSV
              </button>
            </div>

            {tab === 'single' ? (
              <InviteForm
                campaignId={campaign.emrCampaignId}
                onSent={() => setInviteCount((n) => n + 1)}
              />
            ) : (
              <BulkUpload
                campaignId={campaign.emrCampaignId}
                onSent={() => setInviteCount((n) => n + 1)}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Unsubscribed section ────────────────────────────────────────────────────

function UnsubscribedSection() {
  const [expanded, setExpanded] = useState(false);
  const { data, isLoading } = useSWR<UnsubscribesResponse>('/campaigns/unsubscribes', fetcher);

  const unsubscribes = data?.data?.unsubscribes ?? [];
  const total = data?.data?.total ?? 0;

  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-card overflow-hidden">
      <div
        className="flex items-center justify-between px-5 py-4 cursor-pointer hover:bg-slate-50 transition-colors"
        onClick={() => setExpanded((v) => !v)}
      >
        <div className="flex items-center gap-2">
          <UserX size={16} className="text-slate-400" />
          <span className="font-semibold text-slate-900">
            Unsubscribed {total > 0 ? `(${total.toLocaleString()})` : ''}
          </span>
        </div>
        {expanded ? <ChevronUp size={16} className="text-slate-400" /> : <ChevronDown size={16} className="text-slate-400" />}
      </div>

      {expanded && (
        <div className="border-t border-slate-100">
          <div className="px-5 py-3 bg-blue-50 border-b border-blue-100 text-xs text-blue-800">
            These contacts have opted out of review request emails and will be automatically skipped in bulk uploads.
          </div>

          {isLoading && (
            <div className="px-5 py-6 space-y-2">
              {[1, 2, 3].map((n) => (
                <div key={n} className="h-4 bg-slate-100 rounded animate-pulse" />
              ))}
            </div>
          )}

          {!isLoading && unsubscribes.length === 0 && (
            <div className="px-5 py-8 text-center text-sm text-slate-400">
              No unsubscribes yet — great engagement!
            </div>
          )}

          {!isLoading && unsubscribes.length > 0 && (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left">
                  <th className="px-5 py-2 text-xs font-semibold text-slate-400 uppercase tracking-wide">Contact</th>
                  <th className="px-5 py-2 text-xs font-semibold text-slate-400 uppercase tracking-wide">Date Unsubscribed</th>
                </tr>
              </thead>
              <tbody>
                {unsubscribes.map((u, i) => (
                  <tr key={i} className="border-b border-slate-50 last:border-0">
                    <td className="px-5 py-2.5 text-slate-700 font-mono text-xs">{u.contact}</td>
                    <td className="px-5 py-2.5 text-slate-500 text-xs">
                      {new Date(u.unsubscribedAt).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

// ── Page ────────────────────────────────────────────────────────────────────

export default function Campaigns() {
  const { data, error, isLoading } = useSWR<CampaignsResponse>('/campaigns', fetcher);
  const { data: creditsData } = useSWR<CreditsResponse>('/campaigns/credits', fetcher, { refreshInterval: 60_000 });
  const [showNewCampaign, setShowNewCampaign] = useState(false);

  const campaigns = data?.data?.campaigns ?? [];
  const credits = creditsData?.data;

  if (error) {
    return (
      <div className="flex items-center gap-2 text-red-600 text-sm mt-8 justify-center">
        <AlertCircle size={16} /> Failed to load campaigns
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-bold text-slate-900">Review Campaigns</h1>
            <CreditBadge />
          </div>
          <button
            onClick={() => setShowNewCampaign(true)}
            className="whitespace-nowrap inline-flex items-center gap-2 px-1.5 py-1 text-xs sm:px-4 sm:py-2 sm:text-sm font-medium text-white bg-brand-500 hover:bg-brand-600 rounded-lg transition-colors"
          >
            <Plus size={14} /> New Campaign
          </button>
        </div>
        <p className="text-sm text-slate-500">
          Send review requests via EmbedMyReviews. Happy customers are routed to Google; others to a private feedback form.
        </p>
        {credits?.available && credits.total < 50 && (
          <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
            You're running low on review request credits ({credits.total} remaining). Contact support to top up.
          </div>
        )}
      </div>

      {isLoading && (
        <div className="space-y-3">
          {[1, 2].map((n) => (
            <div key={n} className="bg-white border border-slate-200 rounded-xl h-20 animate-pulse" />
          ))}
        </div>
      )}

      {!isLoading && campaigns.length === 0 && (
        <div className="bg-white border border-slate-200 rounded-xl p-8 text-center">
          <Mail size={32} className="mx-auto text-slate-300 mb-3" />
          <h3 className="font-semibold text-slate-700 mb-1">No campaigns yet</h3>
          <p className="text-sm text-slate-400">
            {credits?.connected === false
              ? 'Connect your EmbedMyReviews account in Settings → Integrations to get started.'
              : 'Click "New Campaign" above to create your first review request campaign.'}
          </p>
        </div>
      )}

      {campaigns.map((c) => (
        <CampaignCard key={c.id} campaign={c} />
      ))}

      <UnsubscribedSection />

      {showNewCampaign && <NewCampaignModal onClose={() => setShowNewCampaign(false)} />}
    </div>
  );
}
