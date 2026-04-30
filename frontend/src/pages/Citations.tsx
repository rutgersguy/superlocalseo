import useSWR from 'swr';
import { fetcher } from '../services/api';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Directory {
  id: string;
  name: string;
  listed: boolean;
  napMatch: boolean | null; // null = not applicable (not listed)
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

// ─── Main component ───────────────────────────────────────────────────────────

export default function Citations() {
  const { data, isLoading, error } = useSWR<CitationsResponse>('/citations', fetcher);

  const summary = data?.data;
  const directories = summary?.directories ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Citations</h1>
        <p className="text-sm text-gray-500 mt-1">Business listing status across online directories</p>
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
      ) : directories.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-12 text-center">
          <p className="text-gray-400 text-sm">No directory data available yet.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {directories.map((dir) => (
            <div key={dir.id} className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
              <h3 className="font-semibold text-gray-900 text-sm mb-3">{dir.name}</h3>
              <div className="flex gap-6">
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
          ))}
        </div>
      )}
    </div>
  );
}
