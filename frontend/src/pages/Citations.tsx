import { useState } from 'react';
import useSWR, { mutate } from 'swr';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { fetcher, apiFetch } from '../services/api';

// ─── Types ────────────────────────────────────────────────────────────────────

interface NapDetail {
  nameMatch: boolean | null;
  addressMatch: boolean | null;
  phoneMatch: boolean | null;
  listedName: string | null;
  listedAddress: string | null;
  listedPhone: string | null;
}

interface Directory {
  id: string;
  name: string;
  listed: boolean;
  napMatch: boolean | null;
  napDetail?: NapDetail;
}

interface CitationsResponse {
  success: boolean;
  data: {
    directories: Directory[];
    totalDirectories: number;
    listedCount: number;
    napAccuratePercent: number;
  };
}

interface TrendPoint {
  date: string;
  listedCount: number;
  totalCount: number;
  completeness: number;
}

interface TrendResponse {
  success: boolean;
  data: {
    history: TrendPoint[];
  };
}

type TrendDays = 30 | 90;
type CitationsTab = 'directories' | 'submissions';

const TREND_RANGES: { label: string; value: TrendDays }[] = [
  { label: '30d', value: 30 },
  { label: '90d', value: 90 },
];

interface SubmissionRow {
  id: string;
  locationId: string;
  directory: string;
  status: 'pending' | 'submitted' | 'live' | 'rejected' | 'duplicate';
  listingUrl: string | null;
  rejectionReason: string | null;
  submittedAt: string;
  liveAt: string | null;
}
interface SubmissionsResponse { success: boolean; data: { submissions: SubmissionRow[] }; }

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-gray-100 text-gray-600',
  submitted: 'bg-blue-100 text-blue-700',
  live: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-600',
  duplicate: 'bg-yellow-100 text-yellow-700',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function CheckIcon() {
  return (
    <svg className="w-5 h-5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg className="w-5 h-5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}

function SmallCheckIcon() {
  return (
    <svg className="w-4 h-4 text-green-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
    </svg>
  );
}

function SmallXIcon() {
  return (
    <svg className="w-4 h-4 text-red-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}

function hasNapError(dir: Directory): boolean {
  if (!dir.listed) return false;
  const d = dir.napDetail;
  if (!d) return false;
  return d.nameMatch === false || d.addressMatch === false || d.phoneMatch === false;
}

// ─── Main component ───────────────────────────────────────────────────────────

function SubmitModal({ directories, onClose }: { directories: string[]; onClose: () => void }) {
  const [selected, setSelected] = useState<Set<string>>(new Set(directories));
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = (dir: string) => {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(dir)) n.delete(dir); else n.add(dir);
      return n;
    });
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await apiFetch('/citations/submit', {
        method: 'POST',
        body: JSON.stringify({ directories: Array.from(selected) }),
      });
      await mutate('/citations/submissions');
      setDone(true);
    } catch (e) {
      setError((e as Error).message ?? 'Submission failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md max-h-[80vh] flex flex-col">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">Submit Missing Citations</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 font-bold text-xl">×</button>
        </div>
        {done ? (
          <div className="p-6 text-center">
            <p className="text-green-600 font-medium mb-2">Submitted {selected.size} directories</p>
            <p className="text-sm text-gray-500 mb-4">Track progress in the Submissions tab.</p>
            <button onClick={onClose} className="px-4 py-2 text-sm bg-brand-600 text-white rounded-lg hover:bg-brand-700">Close</button>
          </div>
        ) : (
          <>
            <div className="flex-1 overflow-y-auto px-6 py-3 space-y-1">
              {directories.map((dir) => (
                <label key={dir} className="flex items-center gap-3 py-1.5 cursor-pointer hover:bg-gray-50 rounded px-1">
                  <input type="checkbox" checked={selected.has(dir)} onChange={() => toggle(dir)} className="rounded border-gray-300" />
                  <span className="text-sm text-gray-700">{dir}</span>
                </label>
              ))}
            </div>
            {error && <div className="mx-6 mb-2 p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">{error}</div>}
            <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3">
              <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50">Cancel</button>
              <button onClick={() => void handleSubmit()} disabled={submitting || selected.size === 0}
                className="px-4 py-2 text-sm font-medium bg-brand-600 text-white rounded-lg hover:bg-brand-700 disabled:opacity-50">
                {submitting ? 'Submitting…' : `Submit ${selected.size} directories`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default function Citations() {
  const [trendDays, setTrendDays] = useState<TrendDays>(90);
  const [expandedDir, setExpandedDir] = useState<string | null>(null);
  const [showErrorsOnly, setShowErrorsOnly] = useState(false);
  const [activeTab, setActiveTab] = useState<CitationsTab>('directories');
  const [showSubmitModal, setShowSubmitModal] = useState(false);

  const { data, isLoading, error } = useSWR<CitationsResponse>('/citations', fetcher);
  const { data: trendData, isLoading: trendLoading } = useSWR<TrendResponse>(
    `/citations/history?days=${trendDays}`,
    fetcher,
  );
  const { data: submissionsData } = useSWR<SubmissionsResponse>('/citations/submissions', fetcher);

  const summary = data?.data;
  const directories = summary?.directories ?? [];
  const trendSeries = trendData?.data?.history ?? [];
  const submissions = submissionsData?.data?.submissions ?? [];

  const napErrorCount = directories.filter(hasNapError).length;
  const unlistedDirs = directories.filter((d) => !d.listed).map((d) => d.name);

  const filteredDirs = showErrorsOnly
    ? directories.filter((dir) => {
        if (!dir.listed) return true;
        if (!dir.napDetail) return false;
        return hasNapError(dir);
      })
    : directories;

  return (
    <div className="space-y-6">
      {showSubmitModal && (
        <SubmitModal directories={unlistedDirs} onClose={() => setShowSubmitModal(false)} />
      )}

      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Citations</h1>
          <p className="text-sm text-gray-500 mt-1">Business listing status across online directories</p>
          {napErrorCount > 0 && (
            <p className="text-sm text-red-600 font-medium mt-1">
              {napErrorCount} citation{napErrorCount !== 1 ? 's' : ''} have NAP errors
            </p>
          )}
        </div>
        <div className="flex gap-2">
          {unlistedDirs.length > 0 && (
            <button onClick={() => setShowSubmitModal(true)}
              className="px-1.5 py-1 text-xs sm:px-4 sm:py-2 sm:text-sm font-medium bg-brand-600 text-white rounded-lg hover:bg-brand-700 transition-colors">
              Submit Missing ({unlistedDirs.length})
            </button>
          )}
          <button
            onClick={() => setShowErrorsOnly((v) => !v)}
            className={`px-1.5 py-1 text-xs sm:px-4 sm:py-2 sm:text-sm font-medium rounded-lg border transition-colors ${
              showErrorsOnly ? 'bg-brand-500 text-white border-brand-500' : 'text-slate-600 border-slate-200 hover:bg-slate-50'
            }`}
          >
            Show errors only
          </button>
        </div>
      </div>

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          Failed to load citation data. Please refresh.
        </div>
      )}

      {/* Tab bar */}
      <div className="flex gap-1 border-b border-gray-200">
        <button onClick={() => setActiveTab('directories')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === 'directories' ? 'border-brand-500 text-brand-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
          Directories
        </button>
        <button onClick={() => setActiveTab('submissions')}
          className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === 'submissions' ? 'border-brand-500 text-brand-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
          Submissions
          {submissions.length > 0 && <span className="text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full">{submissions.length}</span>}
        </button>
      </div>

      {activeTab === 'submissions' ? (
        submissions.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-12 text-center">
            <p className="text-gray-400 text-sm">No submissions yet. Use "Submit Missing" to build new citations.</p>
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Directory</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Submitted</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Live</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {submissions.map((s) => (
                  <tr key={s.id}>
                    <td className="px-6 py-3 font-medium text-gray-900">
                      {s.directory}
                      {s.listingUrl && <a href={s.listingUrl} target="_blank" rel="noopener noreferrer" className="ml-2 text-xs text-blue-500 hover:underline">↗</a>}
                    </td>
                    <td className="px-6 py-3">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_COLORS[s.status] ?? 'bg-gray-100 text-gray-600'}`}>
                        {s.status}
                      </span>
                      {s.rejectionReason && <span className="ml-2 text-xs text-red-500">{s.rejectionReason}</span>}
                    </td>
                    <td className="px-6 py-3 text-gray-500 text-xs">{new Date(s.submittedAt).toLocaleDateString()}</td>
                    <td className="px-6 py-3 text-gray-500 text-xs">{s.liveAt ? new Date(s.liveAt).toLocaleDateString() : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : (<>

      {/* Summary bar */}
      {isLoading ? (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 animate-pulse">
          <div className="h-5 bg-gray-200 rounded w-72" />
        </div>
      ) : summary ? (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm px-6 py-4 flex flex-wrap gap-6 items-center">
          <div>
            <span className="text-2xl font-bold text-gray-900">{summary.listedCount}</span>
            <span className="text-sm text-gray-500"> listed / {summary.totalDirectories} total directories</span>
          </div>
          <div className="h-6 w-px bg-gray-200" />
          <div>
            <span className="text-sm text-gray-600">NAP accurate: </span>
            <span
              className={`text-sm font-semibold ${
                summary.napAccuratePercent >= 80 ? 'text-green-600' :
                summary.napAccuratePercent >= 50 ? 'text-yellow-600' : 'text-red-600'
              }`}
            >
              {summary.napAccuratePercent}%
            </span>
          </div>
        </div>
      ) : null}

      {/* Completeness over time */}
      <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-gray-900">Completeness over time</h2>
          <div className="flex gap-1">
            {TREND_RANGES.map((r) => (
              <button
                key={r.value}
                onClick={() => setTrendDays(r.value)}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                  trendDays === r.value ? 'bg-brand-500 text-white' : 'text-gray-500 hover:text-gray-900 hover:bg-gray-100'
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>
        {trendLoading ? (
          <div className="h-48 bg-gray-50 rounded-lg animate-pulse" />
        ) : trendSeries.length === 0 ? (
          <div className="h-48 flex items-center justify-center text-gray-400 text-sm">
            No citation history yet.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={trendSeries} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 11, fill: '#6b7280' }}
                tickFormatter={(v: string) => {
                  const d = new Date(v);
                  return `${d.getMonth() + 1}/${d.getDate()}`;
                }}
              />
              <YAxis
                domain={[0, 100]}
                tick={{ fontSize: 11, fill: '#6b7280' }}
                tickFormatter={(v: number) => `${v}%`}
                width={40}
              />
              <Tooltip
                formatter={(value: number) => [`${value}%`, 'Completeness']}
                labelFormatter={(label: string) => label}
              />
              <Line
                type="monotone"
                dataKey="completeness"
                stroke="#6366f1"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4 }}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Directory grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 9 }, (_, i) => (
            <div key={i} className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 animate-pulse">
              <div className="h-4 bg-gray-200 rounded w-32 mb-3" />
              <div className="flex gap-4">
                <div className="h-3 bg-gray-200 rounded w-20" />
                <div className="h-3 bg-gray-200 rounded w-24" />
              </div>
            </div>
          ))}
        </div>
      ) : filteredDirs.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-12 text-center">
          <p className="text-gray-400 text-sm">
            {showErrorsOnly ? 'No NAP errors found.' : 'No directory data available yet.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredDirs.map((dir) => {
            const isExpanded = expandedDir === dir.name;
            const d = dir.napDetail;
            const hasDetail = d && (d.nameMatch !== null || d.addressMatch !== null || d.phoneMatch !== null);

            return (
              <div
                key={dir.id ?? dir.name}
                className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden"
              >
                <div
                  className={`p-5 ${hasDetail ? 'cursor-pointer hover:bg-gray-50' : ''}`}
                  onClick={() => {
                    if (hasDetail) setExpandedDir(isExpanded ? null : dir.name);
                  }}
                >
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold text-gray-900 text-sm">{dir.name}</h3>
                    {hasDetail && (
                      <span className="text-gray-400 text-xs">{isExpanded ? '▲' : '▼'}</span>
                    )}
                  </div>
                  <div className="flex gap-6 mt-3">
                    <div className="flex items-center gap-1.5">
                      {dir.listed ? <CheckIcon /> : <XIcon />}
                      <span className={`text-xs font-medium ${dir.listed ? 'text-green-600' : 'text-red-500'}`}>
                        {dir.listed ? 'Listed' : 'Not listed'}
                      </span>
                    </div>
                    {dir.listed && (
                      <div className="flex items-center gap-1.5">
                        {dir.napMatch === true ? <CheckIcon /> : dir.napMatch === false ? <XIcon /> : null}
                        {dir.napMatch !== null && (
                          <span className={`text-xs font-medium ${dir.napMatch ? 'text-green-600' : 'text-red-500'}`}>
                            NAP {dir.napMatch ? 'match' : 'mismatch'}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {isExpanded && hasDetail && d && (
                  <div className="border-t border-gray-100 px-5 py-3 bg-gray-50 space-y-2">
                    <div className="flex items-center gap-2">
                      {d.nameMatch === false ? <SmallXIcon /> : <SmallCheckIcon />}
                      <span className="text-xs text-gray-600 font-medium w-14">Name</span>
                      {d.nameMatch === false && d.listedName && (
                        <span className="text-xs text-red-600 truncate">{d.listedName}</span>
                      )}
                      {d.nameMatch !== false && (
                        <span className="text-xs text-gray-400">matches</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {d.addressMatch === false ? <SmallXIcon /> : <SmallCheckIcon />}
                      <span className="text-xs text-gray-600 font-medium w-14">Address</span>
                      {d.addressMatch === false && d.listedAddress && (
                        <span className="text-xs text-red-600 truncate">{d.listedAddress}</span>
                      )}
                      {d.addressMatch !== false && (
                        <span className="text-xs text-gray-400">matches</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {d.phoneMatch === false ? <SmallXIcon /> : <SmallCheckIcon />}
                      <span className="text-xs text-gray-600 font-medium w-14">Phone</span>
                      {d.phoneMatch === false && d.listedPhone && (
                        <span className="text-xs text-red-600 truncate">{d.listedPhone}</span>
                      )}
                      {d.phoneMatch !== false && (
                        <span className="text-xs text-gray-400">matches</span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      </>)}
    </div>
  );
}
