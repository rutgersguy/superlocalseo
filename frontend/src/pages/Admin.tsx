import React, { useState, useEffect, useRef } from 'react';
import useSWR, { mutate } from 'swr';
import { BarChart, Bar, XAxis, Tooltip, ResponsiveContainer, Legend, Cell } from 'recharts';
import { fetcher, apiFetch } from '../services/api';

// ─── Types ────────────────────────────────────────────────────────────────────

interface OverviewData {
  clients: {
    total: number;
    active: number;
    trialing: number;
    pastDue: number;
    canceled: number;
    newThisWeek: number;
    mrr: number;
  };
  auditLeads: { total: number; thisWeek: number };
  health: {
    db: { ok: boolean; latencyMs: number };
    redis: { ok: boolean; latencyMs: number };
  };
  signups: Array<{ date: string; count: number }>;
  queues: QueueStat[];
}

interface QueueStat {
  name: string;
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
  ok: boolean;
  recentFailures?: Array<{ id?: string; name: string; failedReason: string; finishedOn?: number }>;
}

interface AdminClient {
  id: string;
  businessName: string;
  email: string;
  status: string;
  tier: number;
  trialEndsAt: string | null;
  periodEnd: string | null;
  locationCount: number;
  createdAt: string;
}

interface ClientsData {
  clients: AdminClient[];
  total: number;
  page: number;
  pages: number;
}

interface AnalyticsData {
  mrr: Array<{ month: string; mrr: number; activeClients: number }>;
  churn: Array<{ month: string; newClients: number; canceled: number }>;
  tierBreakdown: Array<{ tier: number; count: number }>;
  statusBreakdown: Array<{ status: string; count: number }>;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const TIER_NAMES: Record<number, string> = { 1: 'Starter', 2: 'Growth', 3: 'Pro' };

const STATUS_STYLES: Record<string, string> = {
  active: 'bg-green-100 text-green-700',
  trialing: 'bg-blue-100 text-blue-700',
  past_due: 'bg-amber-100 text-amber-700',
  canceled: 'bg-gray-100 text-gray-500',
};

function fmt$(n: number) {
  return `$${n.toLocaleString()}`;
}

function fmtDate(s: string | null) {
  if (!s) return '—';
  return new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// ─── Stat card ────────────────────────────────────────────────────────────────

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
      <p className="text-xs text-gray-500 font-medium uppercase tracking-wide mb-1">{label}</p>
      <p className="text-2xl font-bold text-gray-900">{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
    </div>
  );
}

// ─── Health dot ───────────────────────────────────────────────────────────────

function HealthDot({ ok, label, detail }: { ok: boolean; label: string; detail?: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${ok ? 'bg-green-500' : 'bg-red-500'}`} />
      <span className="text-sm font-medium text-gray-700">{label}</span>
      {detail && <span className="text-xs text-gray-400">{detail}</span>}
    </div>
  );
}

// ─── Tab bar ──────────────────────────────────────────────────────────────────

type Tab = 'overview' | 'clients' | 'queues' | 'analytics' | 'citations';

function TabBar({ active, onChange }: { active: Tab; onChange: (t: Tab) => void }) {
  const tabs: { key: Tab; label: string }[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'clients', label: 'Clients' },
    { key: 'queues', label: 'Job Queues' },
    { key: 'analytics', label: 'Analytics' },
    { key: 'citations', label: 'Citations' },
  ];
  return (
    <div className="flex gap-1 border-b border-gray-200 mb-6">
      {tabs.map((t) => (
        <button
          key={t.key}
          onClick={() => onChange(t.key)}
          className={`px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px ${
            active === t.key ? 'border-red-500 text-red-600' : 'border-transparent text-gray-500 hover:text-gray-900'
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

// ─── Overview tab ─────────────────────────────────────────────────────────────

function OverviewTab() {
  const { data, isLoading } = useSWR<{ success: boolean; data: OverviewData }>('/admin/overview', fetcher, { refreshInterval: 30_000 });
  const d = data?.data;

  if (isLoading || !d) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 7 }, (_, i) => <div key={i} className="h-24 bg-gray-100 rounded-xl" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <StatCard label="Total Clients" value={d.clients.total} />
        <StatCard label="Active" value={d.clients.active} />
        <StatCard label="MRR" value={fmt$(d.clients.mrr)} sub="active subs only" />
        <StatCard label="New This Week" value={d.clients.newThisWeek} />
        <StatCard label="Trialing" value={d.clients.trialing} />
        <StatCard label="Past Due" value={d.clients.pastDue} />
        <StatCard label="Canceled" value={d.clients.canceled} />
        <StatCard label="Audit Leads" value={d.auditLeads?.total ?? 0} sub={`${d.auditLeads?.thisWeek ?? 0} this week`} />
      </div>

      {/* Health + Signups side by side */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* System health */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
          <h3 className="text-sm font-semibold text-gray-900 mb-4">System Health</h3>
          <div className="space-y-3">
            <HealthDot
              ok={d.health.db.ok}
              label="Database"
              detail={d.health.db.ok ? `${d.health.db.latencyMs}ms` : 'unreachable'}
            />
            <HealthDot
              ok={d.health.redis.ok}
              label="Redis"
              detail={d.health.redis.ok ? `${d.health.redis.latencyMs}ms` : 'unreachable'}
            />
            {d.queues.map((q) => (
              <HealthDot
                key={q.name}
                ok={q.ok && q.failed === 0}
                label={`Queue: ${q.name}`}
                detail={q.failed > 0 ? `${q.failed} failed` : q.active > 0 ? `${q.active} active` : 'idle'}
              />
            ))}
          </div>
        </div>

        {/* Signup sparkline */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
          <h3 className="text-sm font-semibold text-gray-900 mb-4">Signups (last 14 days)</h3>
          {d.signups.length === 0 ? (
            <p className="text-sm text-gray-400">No signups in this period.</p>
          ) : (
            <ResponsiveContainer width="100%" height={140}>
              <BarChart data={d.signups} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 10 }}
                  tickFormatter={(v: string) => new Date(v).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                />
                <Tooltip
                  formatter={(v: number) => [v, 'Signups']}
                  labelFormatter={(l: string) => fmtDate(l)}
                />
                <Bar dataKey="count" fill="#ef4444" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Clients tab ──────────────────────────────────────────────────────────────

function ClientsTab() {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);

  const params = new URLSearchParams({ page: String(page), limit: '25' });
  if (search) params.set('search', search);
  if (status) params.set('status', status);

  const { data, isLoading } = useSWR<{ success: boolean; data: ClientsData }>(
    `/admin/clients?${params.toString()}`,
    fetcher,
    { keepPreviousData: true },
  );
  const d = data?.data;

  const handleSearch = (v: string) => { setSearch(v); setPage(1); };
  const handleStatus = (v: string) => { setStatus(v); setPage(1); };

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <input
          type="text"
          placeholder="Search by name or email…"
          value={search}
          onChange={(e) => handleSearch(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-400 w-64"
        />
        <select
          value={status}
          onChange={(e) => handleStatus(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-400"
        >
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="trialing">Trialing</option>
          <option value="past_due">Past Due</option>
          <option value="canceled">Canceled</option>
        </select>
        {d && <span className="text-sm text-gray-400 self-center">{d.total} clients</span>}
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Business</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Email</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Plan</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Trial / Renews</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Locations</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Signed Up</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {isLoading ? (
                Array.from({ length: 8 }, (_, i) => (
                  <tr key={i} className="animate-pulse">
                    {Array.from({ length: 7 }, (_, j) => (
                      <td key={j} className="px-4 py-3"><div className="h-4 bg-gray-100 rounded" /></td>
                    ))}
                  </tr>
                ))
              ) : d?.clients.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">No clients found.</td></tr>
              ) : (
                d?.clients.map((c) => (
                  <tr key={c.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 font-medium text-gray-900 max-w-[180px] truncate">{c.businessName}</td>
                    <td className="px-4 py-3 text-gray-500 max-w-[200px] truncate">{c.email}</td>
                    <td className="px-4 py-3 text-gray-700">{TIER_NAMES[c.tier] ?? `Tier ${c.tier}`}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full capitalize ${STATUS_STYLES[c.status] ?? 'bg-gray-100 text-gray-500'}`}>
                        {c.status.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-xs">
                      {c.status === 'trialing' ? fmtDate(c.trialEndsAt) : fmtDate(c.periodEnd)}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-700">{c.locationCount}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{fmtDate(c.createdAt)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {d && d.pages > 1 && (
          <div className="px-4 py-3 border-t border-gray-100 flex items-center justify-between">
            <span className="text-xs text-gray-500">Page {d.page} of {d.pages}</span>
            <div className="flex gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-3 py-1.5 text-xs font-medium border border-gray-200 rounded-lg disabled:opacity-40 hover:bg-gray-50"
              >
                Previous
              </button>
              <button
                onClick={() => setPage((p) => Math.min(d.pages, p + 1))}
                disabled={page === d.pages}
                className="px-3 py-1.5 text-xs font-medium border border-gray-200 rounded-lg disabled:opacity-40 hover:bg-gray-50"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Queues tab ───────────────────────────────────────────────────────────────

function QueuesTab() {
  const { data, isLoading } = useSWR<{ success: boolean; data: { queues: QueueStat[] } }>(
    '/admin/queues',
    fetcher,
    { refreshInterval: 15_000 },
  );
  const queues = data?.data?.queues ?? [];

  return (
    <div className="space-y-6">
      {/* Queue health table */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100">
          <h3 className="text-sm font-semibold text-gray-900">Queue Status</h3>
          <p className="text-xs text-gray-400 mt-0.5">Refreshes every 15 seconds</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Queue</th>
                <th className="px-5 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Waiting</th>
                <th className="px-5 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Active</th>
                <th className="px-5 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Completed</th>
                <th className="px-5 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Delayed</th>
                <th className="px-5 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Failed</th>
                <th className="px-5 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {isLoading ? (
                Array.from({ length: 9 }, (_, i) => (
                  <tr key={i} className="animate-pulse">
                    {Array.from({ length: 7 }, (_, j) => (
                      <td key={j} className="px-5 py-3"><div className="h-4 bg-gray-100 rounded" /></td>
                    ))}
                  </tr>
                ))
              ) : (
                queues.map((q) => (
                  <tr key={q.name} className="hover:bg-gray-50">
                    <td className="px-5 py-3 font-mono text-xs text-gray-800">{q.name}</td>
                    <td className="px-5 py-3 text-right text-gray-700">{q.waiting}</td>
                    <td className={`px-5 py-3 text-right font-medium ${q.active > 0 ? 'text-blue-600' : 'text-gray-400'}`}>{q.active}</td>
                    <td className="px-5 py-3 text-right text-gray-400">{q.completed}</td>
                    <td className="px-5 py-3 text-right text-gray-400">{q.delayed}</td>
                    <td className={`px-5 py-3 text-right font-medium ${q.failed > 0 ? 'text-red-600' : 'text-gray-400'}`}>{q.failed}</td>
                    <td className="px-5 py-3 text-center">
                      {!q.ok ? (
                        <span className="text-xs font-medium text-red-600">unreachable</span>
                      ) : q.failed > 0 ? (
                        <span className="inline-block w-2.5 h-2.5 rounded-full bg-red-500" title="has failures" />
                      ) : q.active > 0 ? (
                        <span className="inline-block w-2.5 h-2.5 rounded-full bg-blue-500" title="processing" />
                      ) : (
                        <span className="inline-block w-2.5 h-2.5 rounded-full bg-green-500" title="healthy" />
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Recent failures */}
      {queues.some((q) => (q.recentFailures?.length ?? 0) > 0) && (
        <div className="bg-white rounded-xl border border-red-100 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-red-100 bg-red-50">
            <h3 className="text-sm font-semibold text-red-800">Recent Failures</h3>
          </div>
          <div className="divide-y divide-gray-50">
            {queues.flatMap((q) =>
              (q.recentFailures ?? []).map((f, i) => (
                <div key={`${q.name}-${i}`} className="px-5 py-3">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <span className="text-xs font-mono text-gray-500 mr-2">{q.name}</span>
                      <span className="text-xs font-medium text-gray-800">{f.name}</span>
                      <p className="text-xs text-red-600 mt-0.5 truncate">{f.failedReason}</p>
                    </div>
                    {f.finishedOn && (
                      <span className="text-xs text-gray-400 shrink-0">{fmtDate(new Date(f.finishedOn).toISOString())}</span>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Analytics tab ────────────────────────────────────────────────────────────

const TIER_NAMES_CHART: Record<number, string> = { 1: 'Starter', 2: 'Growth', 3: 'Pro' };

function fmtMonth(monthStr: string): string {
  // DATE_TRUNC returns e.g. "2026-01-01T00:00:00.000Z" or "2026-01"
  // Append day to ensure correct parsing regardless of format
  const normalized = monthStr.length === 7 ? `${monthStr}-01` : monthStr;
  return new Date(normalized).toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
}

function AnalyticsTab() {
  const { data, isLoading } = useSWR<{ success: boolean; data: AnalyticsData }>(
    '/admin/analytics',
    fetcher,
  );
  const d = data?.data;

  if (isLoading || !d) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="h-64 bg-gray-100 rounded-xl" />
          <div className="h-64 bg-gray-100 rounded-xl" />
        </div>
        <div className="h-16 bg-gray-100 rounded-xl" />
      </div>
    );
  }

  const churnData = d.churn.map((r) => ({ ...r, month: fmtMonth(r.month) }));
  const tierData = d.tierBreakdown.map((r) => ({
    name: TIER_NAMES_CHART[r.tier] ?? `Tier ${r.tier}`,
    count: r.count,
  }));

  const TIER_COLORS: Record<string, string> = {
    Starter: '#60a5fa',
    Growth: '#34d399',
    Pro: '#f59e0b',
  };

  return (
    <div className="space-y-6">
      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Signups vs Cancellations */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
          <h3 className="text-sm font-semibold text-gray-900 mb-4">New Signups vs Cancellations (last 12 months)</h3>
          {churnData.length === 0 ? (
            <p className="text-sm text-gray-400">No data available.</p>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={churnData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                <XAxis dataKey="month" tick={{ fontSize: 10 }} />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="newClients" name="New Signups" fill="#22c55e" radius={[3, 3, 0, 0]} />
                <Bar dataKey="canceled" name="Canceled" fill="#ef4444" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Tier breakdown */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
          <h3 className="text-sm font-semibold text-gray-900 mb-4">Clients by Tier (current)</h3>
          {tierData.length === 0 ? (
            <p className="text-sm text-gray-400">No data available.</p>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={tierData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                <Tooltip formatter={(v: number) => [v, 'Clients']} />
                <Bar
                  dataKey="count"
                  radius={[3, 3, 0, 0]}
                  label={{ position: 'top', fontSize: 11, fill: '#6b7280' }}
                >
                  {tierData.map((entry) => (
                    <Cell key={entry.name} fill={TIER_COLORS[entry.name] ?? '#94a3b8'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Status breakdown */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
        <h3 className="text-sm font-semibold text-gray-900 mb-4">Status Breakdown (current)</h3>
        <div className="flex flex-wrap gap-3">
          {d.statusBreakdown.map((s) => (
            <div key={s.status} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-50 border border-gray-100">
              <span className={`text-xs font-medium px-2 py-0.5 rounded-full capitalize ${STATUS_STYLES[s.status] ?? 'bg-gray-100 text-gray-500'}`}>
                {s.status.replace('_', ' ')}
              </span>
              <span className="text-sm font-bold text-gray-900">{s.count}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Citation Builder wizard (admin) ─────────────────────────────────────────

const CB_PACKAGES = [
  { id: 'cb0', label: 'Aggregators only' },
  { id: 'cb10', label: '10 citations' }, { id: 'cb15', label: '15 citations' },
  { id: 'cb25', label: '25 citations' }, { id: 'cb30', label: '30 citations' },
  { id: 'cb50', label: '50 citations' }, { id: 'cb75', label: '75 citations' },
  { id: 'cb100', label: '100 citations' },
];

const CB_PUBLISHERS = [
  { id: 'dataaxle', label: 'Data Axle' }, { id: 'neustar', label: 'Neustar' },
  { id: 'foursquare', label: 'Foursquare' }, { id: 'ypnetwork', label: 'YP Network' },
  { id: 'gpsnetwork', label: 'GPS Network' },
];

interface AdminLocation { locationId: string; locationName: string; clientId: string; clientName: string; blLocationId: number | null; }
interface LookupCitation { domain: string; profileUrl: string; }

type WizardStep = 'select' | 'creating' | 'lookup' | 'configure' | 'done';

function AdminCitationWizard({ onClose }: { onClose: () => void }) {
  const { data: locData } = useSWR<{ success: boolean; data: { locations: AdminLocation[] } }>('/admin/citations/locations', fetcher);
  const allLocations = locData?.data?.locations ?? [];

  const clientIds = Array.from(new Set(allLocations.map((l) => l.clientId)));
  const clients = clientIds.map((id) => ({ id, name: allLocations.find((l) => l.clientId === id)!.clientName }));

  const [selectedClientId, setSelectedClientId] = useState('');
  const [selectedLocationId, setSelectedLocationId] = useState('');
  const [step, setStep] = useState<WizardStep>('select');
  const [campaignId, setCampaignId] = useState<string | null>(null);
  const [lookupCitations, setLookupCitations] = useState<LookupCitation[]>([]);
  const [packageId, setPackageId] = useState('cb25');
  const [selectedDomains, setSelectedDomains] = useState<Set<string>>(new Set());
  const [selectedPublishers, setSelectedPublishers] = useState<Set<string>>(new Set(['dataaxle', 'neustar', 'foursquare', 'ypnetwork', 'gpsnetwork']));
  const [removeDuplicates, setRemoveDuplicates] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const filteredLocations = allLocations.filter((l) => l.clientId === selectedClientId);

  const createCampaign = async () => {
    setError(null);
    setStep('creating');
    try {
      const res = await apiFetch<{ success: boolean; data?: { campaignId: string }; error?: { message: string } }>('/admin/citations/campaign', {
        method: 'POST',
        body: JSON.stringify({ clientId: selectedClientId, locationId: selectedLocationId }),
      });
      if (!res.success || !res.data?.campaignId) throw new Error(res.error?.message ?? 'Failed to create campaign');
      setCampaignId(res.data.campaignId);
      setStep('lookup');
    } catch (e) {
      setError((e as Error).message);
      setStep('select');
    }
  };

  useEffect(() => {
    if (step !== 'lookup' || !campaignId) return;
    const poll = async () => {
      try {
        const res = await apiFetch<{ success: boolean; data: { lookupStatus: string; citations: LookupCitation[] } }>(`/admin/citations/campaign/${encodeURIComponent(campaignId)}/lookup`);
        if (res.data.lookupStatus === 'complete') {
          setLookupCitations(res.data.citations);
          setSelectedDomains(new Set(res.data.citations.map((c) => c.domain)));
          setStep('configure');
          return;
        }
      } catch { /* keep polling */ }
      pollRef.current = setTimeout(poll, 4000);
    };
    void poll();
    return () => { if (pollRef.current) clearTimeout(pollRef.current); };
  }, [step, campaignId]);

  const handleConfirm = async () => {
    if (!campaignId) return;
    setConfirming(true);
    setError(null);
    try {
      const res = await apiFetch<{ success: boolean; error?: string }>(`/admin/citations/campaign/${encodeURIComponent(campaignId)}/confirm`, {
        method: 'POST',
        body: JSON.stringify({
          clientId: selectedClientId, locationId: selectedLocationId,
          packageId, citations: Array.from(selectedDomains),
          publishers: Array.from(selectedPublishers),
          removeDuplicates, autoSelect: false, express: false,
        }),
      });
      if (!res.success) throw new Error(res.error ?? 'Confirmation failed');
      await mutate('/admin/citations');
      setStep('done');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setConfirming(false);
    }
  };

  const toggle = (_current: Set<string>, setFn: React.Dispatch<React.SetStateAction<Set<string>>>, val: string) => {
    setFn((s) => { const n = new Set(s); n.has(val) ? n.delete(val) : n.add(val); return n; });
  };

  const pkgCount = parseInt(packageId.replace('cb', '')) || 0;
  const overLimit = pkgCount > 0 && selectedDomains.size > pkgCount;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between flex-shrink-0">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Citation Builder</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              {step === 'select' && 'Select a client and location'}
              {step === 'creating' && 'Creating campaign…'}
              {step === 'lookup' && 'Scanning citation opportunities…'}
              {step === 'configure' && `${lookupCitations.length} opportunities found`}
              {step === 'done' && 'Campaign confirmed'}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl font-bold">×</button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {step === 'select' && (
            <div className="p-6 space-y-4">
              {error && <div className="p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">{error}</div>}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Client</label>
                <select value={selectedClientId} onChange={(e) => { setSelectedClientId(e.target.value); setSelectedLocationId(''); }}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-400">
                  <option value="">Select a client…</option>
                  {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              {selectedClientId && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Location</label>
                  <select value={selectedLocationId} onChange={(e) => setSelectedLocationId(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-400">
                    <option value="">Select a location…</option>
                    {filteredLocations.map((l) => <option key={l.locationId} value={l.locationId}>{l.locationName}</option>)}
                  </select>
                </div>
              )}
            </div>
          )}

          {(step === 'creating' || step === 'lookup') && (
            <div className="p-12 flex flex-col items-center gap-4">
              <div className="w-10 h-10 border-4 border-red-500 border-t-transparent rounded-full animate-spin" />
              <p className="text-sm text-gray-500">{step === 'creating' ? 'Setting up campaign…' : 'Scanning opportunities — may take a minute…'}</p>
            </div>
          )}

          {step === 'configure' && (
            <div className="divide-y divide-gray-100">
              <div className="px-6 py-4">
                <h3 className="text-sm font-semibold text-gray-800 mb-3">Package</h3>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {CB_PACKAGES.map((pkg) => (
                    <button key={pkg.id} onClick={() => setPackageId(pkg.id)}
                      className={`px-3 py-2.5 rounded-lg border text-left text-sm transition-colors ${packageId === pkg.id ? 'border-red-500 bg-red-50 text-red-800' : 'border-gray-200 hover:border-gray-300 text-gray-700'}`}>
                      {pkg.label}
                    </button>
                  ))}
                </div>
                {overLimit && <p className="text-xs text-amber-600 mt-2">Selected {selectedDomains.size} directories but package allows {pkgCount}.</p>}
              </div>

              {lookupCitations.length > 0 && packageId !== 'cb0' && (
                <div className="px-6 py-4">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-semibold text-gray-800">Directories <span className="text-xs font-normal text-gray-400">{selectedDomains.size} selected</span></h3>
                    <div className="flex gap-2 text-xs">
                      <button onClick={() => setSelectedDomains(new Set(lookupCitations.map((c) => c.domain)))} className="text-red-500 hover:underline">All</button>
                      <button onClick={() => setSelectedDomains(new Set())} className="text-gray-400 hover:underline">None</button>
                    </div>
                  </div>
                  <div className="max-h-48 overflow-y-auto space-y-0.5 pr-1">
                    {lookupCitations.map((c) => (
                      <label key={c.domain} className="flex items-center gap-3 px-2 py-1.5 rounded hover:bg-gray-50 cursor-pointer">
                        <input type="checkbox" checked={selectedDomains.has(c.domain)} onChange={() => toggle(selectedDomains, setSelectedDomains as React.Dispatch<React.SetStateAction<Set<string>>>, c.domain)} className="rounded border-gray-300" />
                        <span className="text-sm text-gray-700 flex-1">{c.domain}</span>
                        {c.profileUrl && <a href={c.profileUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-400 hover:underline">↗</a>}
                      </label>
                    ))}
                  </div>
                </div>
              )}

              <div className="px-6 py-4">
                <h3 className="text-sm font-semibold text-gray-800 mb-3">Aggregator networks</h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {CB_PUBLISHERS.map((pub) => (
                    <label key={pub.id} className="flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" checked={selectedPublishers.has(pub.id)} onChange={() => toggle(selectedPublishers, setSelectedPublishers as React.Dispatch<React.SetStateAction<Set<string>>>, pub.id)} className="rounded border-gray-300" />
                      <span className="text-sm text-gray-700">{pub.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="px-6 py-4">
                <label className="flex items-center gap-3 cursor-pointer">
                  <input type="checkbox" checked={removeDuplicates} onChange={(e) => setRemoveDuplicates(e.target.checked)} className="rounded border-gray-300" />
                  <div>
                    <span className="text-sm text-gray-700">Remove duplicates</span>
                    <p className="text-xs text-gray-400">Clean up existing duplicate listings.</p>
                  </div>
                </label>
              </div>

              {error && <div className="px-6 py-3"><div className="p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">{error}</div></div>}
            </div>
          )}

          {step === 'done' && (
            <div className="p-12 text-center space-y-3">
              <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mx-auto">
                <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
              </div>
              <p className="font-semibold text-gray-900">Campaign confirmed</p>
              <p className="text-sm text-gray-500">Citations submitted. Track progress in the submissions table.</p>
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3 flex-shrink-0">
          {step === 'done' ? (
            <button onClick={onClose} className="px-4 py-2 text-sm font-medium bg-red-600 text-white rounded-lg hover:bg-red-700">Done</button>
          ) : step === 'select' ? (
            <>
              <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50">Cancel</button>
              <button disabled={!selectedClientId || !selectedLocationId} onClick={() => void createCampaign()}
                className="px-4 py-2 text-sm font-medium bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50">
                Continue
              </button>
            </>
          ) : step === 'configure' ? (
            <>
              <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50">Cancel</button>
              <button disabled={confirming || !!overLimit} onClick={() => void handleConfirm()}
                className="px-4 py-2 text-sm font-medium bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 flex items-center gap-2">
                {confirming && <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                Confirm &amp; Submit
              </button>
            </>
          ) : (
            <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50">Cancel</button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Citations tab ────────────────────────────────────────────────────────────

interface CitationSubmissionRow {
  id: string;
  directory: string;
  status: string;
  listingUrl: string | null;
  submittedAt: string;
  liveAt: string | null;
  blSubmissionId: string | null;
  clientName: string;
  locationName: string;
}

interface CitationsOverview {
  credits: number;
  byStatus: Record<string, number>;
  submissions: CitationSubmissionRow[];
}

const SUB_STATUS_STYLES: Record<string, string> = {
  pending:   'bg-gray-100 text-gray-600',
  submitted: 'bg-blue-100 text-blue-700',
  live:      'bg-green-100 text-green-700',
  rejected:  'bg-red-100 text-red-600',
  duplicate: 'bg-yellow-100 text-yellow-700',
};

function CitationsTab() {
  const [showWizard, setShowWizard] = useState(false);
  const { data, isLoading } = useSWR<{ success: boolean; data: CitationsOverview }>(
    '/admin/citations',
    fetcher,
    { refreshInterval: 60_000 },
  );
  const d = data?.data;

  return (
    <div className="space-y-6">
      {showWizard && <AdminCitationWizard onClose={() => setShowWizard(false)} />}

      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-800">Citation Builder</h3>
        <button onClick={() => setShowWizard(true)}
          className="px-4 py-2 text-sm font-medium bg-red-600 text-white rounded-lg hover:bg-red-700">
          Run Builder for Client
        </button>
      </div>

      {/* Credit balance + status breakdown */}
      {isLoading || !d ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 animate-pulse">
          {Array.from({ length: 4 }, (_, i) => <div key={i} className="h-24 bg-gray-100 rounded-xl" />)}
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <StatCard label="CB Credits Remaining" value={d.credits} sub="BrightLocal account" />
          <StatCard label="Live" value={d.byStatus['live'] ?? 0} sub="citations live" />
          <StatCard label="Pending / Submitted" value={(d.byStatus['pending'] ?? 0) + (d.byStatus['submitted'] ?? 0)} sub="in progress" />
          <StatCard label="Total Submissions" value={d.submissions.length} sub="all time" />
        </div>
      )}

      {/* Submissions table */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100">
          <h3 className="text-sm font-semibold text-gray-900">All Citation Submissions</h3>
          <p className="text-xs text-gray-400 mt-0.5">Across all clients — most recent first</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Client</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Location</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Directory</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Submitted</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Live</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {isLoading ? (
                Array.from({ length: 8 }, (_, i) => (
                  <tr key={i} className="animate-pulse">
                    {Array.from({ length: 6 }, (_, j) => (
                      <td key={j} className="px-4 py-3"><div className="h-4 bg-gray-100 rounded" /></td>
                    ))}
                  </tr>
                ))
              ) : !d || d.submissions.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400 text-sm">No submissions yet.</td></tr>
              ) : (
                d.submissions.map((s) => (
                  <tr key={s.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900 max-w-[140px] truncate">{s.clientName}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs max-w-[120px] truncate">{s.locationName}</td>
                    <td className="px-4 py-3 text-gray-700">
                      {s.directory}
                      {s.listingUrl && (
                        <a href={s.listingUrl} target="_blank" rel="noopener noreferrer" className="ml-1.5 text-xs text-blue-400 hover:underline">↗</a>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${SUB_STATUS_STYLES[s.status] ?? 'bg-gray-100 text-gray-600'}`}>
                        {s.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-400 text-xs">{fmtDate(s.submittedAt)}</td>
                    <td className="px-4 py-3 text-gray-400 text-xs">{s.liveAt ? fmtDate(s.liveAt) : '—'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function Admin() {
  const [tab, setTab] = useState<Tab>('overview');

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Admin</h1>
          <p className="text-sm text-gray-500 mt-1">Platform health, client activity, and job queue status</p>
        </div>
        <span className="ml-auto text-xs font-medium px-2.5 py-1 rounded-full bg-red-100 text-red-700">Internal</span>
      </div>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
        <TabBar active={tab} onChange={setTab} />
        {tab === 'overview' && <OverviewTab />}
        {tab === 'clients' && <ClientsTab />}
        {tab === 'queues' && <QueuesTab />}
        {tab === 'analytics' && <AnalyticsTab />}
        {tab === 'citations' && <CitationsTab />}
      </div>
    </div>
  );
}
