import { Link } from 'react-router-dom';
import useSWR from 'swr';
import { Sparkles, Check, X, HelpCircle } from 'lucide-react';
import { fetcher } from '../services/api';

/**
 * Shared AI-visibility pieces: the dashboard hero and the primitives the full
 * page reuses.
 *
 * THE THREE STATES MUST STAY THREE
 * --------------------------------
 * `unverified` means the assistant failed, refused, or the business name is too
 * generic to detect — it is NOT "you were not recommended". Rendering it as a
 * miss would put a claim in front of a paying customer that the data does not
 * support, and it is the exact failure the backend's three-state design exists
 * to prevent. It gets its own neutral treatment and is excluded from the rate.
 */

export interface EngineRollup {
  engine: string;
  label: string;
  mentioned: number;
  absent: number;
  unverified: number;
  determinate: number;
  bestPosition: number | null;
}

export interface PromptResult {
  snapshotId: string;
  engine: string;
  label: string;
  modelName: string;
  status: 'mentioned' | 'absent' | 'unverified';
  position: number | null;
  unverifiedReason: string | null;
  locationName: string;
  /** Pro only — absent from the payload on Lite. */
  businessesNamed?: string[];
  citations?: string[];
}

export interface AiVisibilityData {
  plan: 'lite' | 'pro';
  scannedAt: string | null;
  nextScanAt: string | null;
  locations: Array<{ id: string; name: string }>;
  mentionRate: number | null;
  engines: EngineRollup[];
  prompts: Array<{ promptKey: string; promptText: string; intent: string; results: PromptResult[] }>;
  history?: Array<{ scannedAt: string; mentionRate: number | null }>;
  topCompetitors?: Array<{ name: string; timesNamed: number }>;
  topSources?: Array<{ host: string; timesCited: number }>;
}

export function useAiVisibility() {
  return useSWR<{ success: boolean; data: AiVisibilityData }>('/ai-visibility', fetcher);
}

export function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// ─── Status pill ──────────────────────────────────────────────────────────────

export function StatusPill({ status, position }: { status: PromptResult['status']; position: number | null }) {
  if (status === 'mentioned') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
        <Check size={12} strokeWidth={3} />
        {position != null ? `Recommended · #${position}` : 'Recommended'}
      </span>
    );
  }
  if (status === 'absent') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full bg-red-50 text-red-700 border border-red-200">
        <X size={12} strokeWidth={3} />
        Not mentioned
      </span>
    );
  }
  // Deliberately neutral — grey, not red. This is "we could not check", and a
  // customer must never read an outage as a verdict about their business.
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full bg-slate-100 text-slate-500 border border-slate-200">
      <HelpCircle size={12} strokeWidth={3} />
      Couldn't check
    </span>
  );
}

// ─── Engine card ──────────────────────────────────────────────────────────────

function EngineCard({ e }: { e: EngineRollup }) {
  const noVerdict = e.determinate === 0;
  const strong = e.mentioned > 0;

  return (
    <div
      className={`rounded-xl border p-4 flex flex-col gap-2 ${
        noVerdict ? 'bg-slate-50 border-slate-200'
          : strong ? 'bg-emerald-50/60 border-emerald-200'
          : 'bg-red-50/50 border-red-200'
      }`}
    >
      <p className="text-sm font-semibold text-slate-900">{e.label}</p>

      {noVerdict ? (
        <>
          <p className="text-lg font-bold text-slate-400">Couldn't check</p>
          <p className="text-xs text-slate-400">We'll try again on the next scan.</p>
        </>
      ) : strong ? (
        <>
          <p className="text-2xl font-bold text-emerald-700">
            {e.bestPosition != null ? `#${e.bestPosition}` : 'Yes'}
          </p>
          <p className="text-xs text-emerald-700/80">
            Recommends you in {e.mentioned} of {e.determinate} question{e.determinate === 1 ? '' : 's'}
          </p>
        </>
      ) : (
        <>
          <p className="text-2xl font-bold text-red-600">Not mentioned</p>
          <p className="text-xs text-red-600/80">
            In {e.absent} question{e.absent === 1 ? '' : 's'} it named other businesses
          </p>
        </>
      )}

      {e.unverified > 0 && e.determinate > 0 && (
        <p className="text-[11px] text-slate-400 pt-0.5 border-t border-slate-200/70">
          {e.unverified} check{e.unverified === 1 ? '' : 's'} couldn't be completed — not counted
        </p>
      )}
    </div>
  );
}

// ─── Dashboard hero ───────────────────────────────────────────────────────────

function HeroSkeleton() {
  return (
    <div className="bg-white rounded-2xl shadow-card p-6 space-y-4">
      <div className="h-5 w-64 bg-slate-100 rounded animate-pulse" />
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {[0, 1, 2].map((i) => <div key={i} className="h-28 bg-slate-100 rounded-xl animate-pulse" />)}
      </div>
    </div>
  );
}

/**
 * The logged-in answer to the question the marketing site asks.
 *
 * This sits at the top of the dashboard, above the ranking metrics, because
 * someone who converted on "does ChatGPT recommend your business?" must see the
 * answer first — landing them on a keyword table is the mismatch this panel
 * exists to close (docs/POSITIONING.md).
 */
export function AiVisibilityHero() {
  const { data, error, isLoading } = useAiVisibility();

  if (isLoading) return <HeroSkeleton />;
  if (error) return null; // the dashboard has plenty else to show; don't block it

  const d = data?.data;
  if (!d) return null;

  // Nothing scanned yet — a new account before its first Monday.
  if (!d.scannedAt) {
    return (
      <div className="bg-white rounded-2xl shadow-card p-6">
        <div className="flex items-start gap-3">
          <Sparkles size={20} className="text-brand-500 shrink-0 mt-0.5" />
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              Do AI assistants recommend your business?
            </h2>
            <p className="text-sm text-slate-500 mt-1">
              We ask ChatGPT, Gemini and Perplexity the questions your customers ask — every Monday.
              {d.nextScanAt && <> Your first check runs {fmtDate(d.nextScanAt)}.</>}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl shadow-card overflow-hidden">
      <div className="px-6 pt-6 pb-4 flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <Sparkles size={20} className="text-brand-500 shrink-0 mt-0.5" />
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              Do AI assistants recommend your business?
            </h2>
            <p className="text-sm text-slate-500 mt-0.5">
              {d.mentionRate != null ? (
                <>
                  You're recommended in <span className="font-semibold text-slate-700">{d.mentionRate}%</span> of
                  the questions we asked · checked {fmtDate(d.scannedAt)}
                </>
              ) : (
                <>Checked {fmtDate(d.scannedAt)}</>
              )}
            </p>
          </div>
        </div>
        <Link
          to="/dashboard/ai-visibility"
          className="shrink-0 text-xs font-medium text-brand-600 hover:text-brand-700 transition-colors"
        >
          See the details →
        </Link>
      </div>

      <div className="px-6 pb-6 grid grid-cols-1 sm:grid-cols-3 gap-3">
        {d.engines.map((e) => <EngineCard key={e.engine} e={e} />)}
      </div>
    </div>
  );
}
