import { useState } from 'react';
import useSWR from 'swr';
import { BarChart, Bar, XAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { fetcher } from '../services/api';

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

type Tab = 'overview' | 'clients' | 'queues';

function TabBar({ active, onChange }: { active: Tab; onChange: (t: Tab) => void }) {
  const tabs: { key: Tab; label: string }[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'clients', label: 'Clients' },
    { key: 'queues', label: 'Job Queues' },
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
      </div>
    </div>
  );
}
