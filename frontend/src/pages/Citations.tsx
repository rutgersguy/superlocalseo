import { useState } from 'react';
import useSWR from 'swr';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { fetcher } from '../services/api';

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
  completeness: number;
}

interface TrendResponse {
  success: boolean;
  data: {
    series: TrendPoint[];
    days: number;
  };
}

type TrendDays = 30 | 90 | 180;

const TREND_RANGES: { label: string; value: TrendDays }[] = [
  { label: '30d', value: 30 },
  { label: '90d', value: 90 },
  { label: '180d', value: 180 },
];

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

export default function Citations() {
  const [trendDays, setTrendDays] = useState<TrendDays>(90);
  const [expandedDir, setExpandedDir] = useState<string | null>(null);
  const [showErrorsOnly, setShowErrorsOnly] = useState(false);

  const { data, isLoading, error } = useSWR<CitationsResponse>('/citations', fetcher);
  const { data: trendData, isLoading: trendLoading } = useSWR<TrendResponse>(
    `/analytics/citations/trend?days=${trendDays}`,
    fetcher,
  );

  const summary = data?.data;
  const directories = summary?.directories ?? [];
  const trendSeries = trendData?.data?.series ?? [];

  const napErrorCount = directories.filter(hasNapError).length;

  const filteredDirs = showErrorsOnly
    ? directories.filter((dir) => {
        if (!dir.listed) return true;
        if (!dir.napDetail) return false;
        return hasNapError(dir);
      })
    : directories;

  return (
    <div className="space-y-6">
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
        <button
          onClick={() => setShowErrorsOnly((v) => !v)}
          className={`px-4 py-2 text-sm font-medium rounded-lg border transition-colors ${
            showErrorsOnly ? 'bg-brand-500 text-white border-brand-500' : 'text-gray-600 border-gray-300 hover:bg-gray-50'
          }`}
        >
          Show errors only
        </button>
      </div>

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          Failed to load citation data. Please refresh.
        </div>
      )}

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
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
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
            No trend data available yet.
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
    </div>
  );
}
