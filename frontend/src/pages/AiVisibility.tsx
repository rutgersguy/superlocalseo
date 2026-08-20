import { useState } from 'react';
import { Link } from 'react-router-dom';
import useSWR from 'swr';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { Sparkles, ExternalLink, Lock } from 'lucide-react';
import { fetcher } from '../services/api';
import { useAiVisibility, StatusPill, fmtDate, type PromptResult } from '../components/AiVisibility';

/**
 * AI assistant visibility, in full (#191).
 *
 * The page is Lite-inclusive by design: the verdict is what the marketing site
 * converts on, so paywalling it would sell Lite a promise it cannot open. The
 * DEPTH is Pro — the competitors each assistant named instead, the sources it
 * cited, the history, and the stored answer behind each verdict.
 *
 * Lite-ness is detected from the payload itself (`plan`), and the Pro fields are
 * genuinely absent rather than hidden, so this page cannot leak them by mistake.
 */

interface AnswerData {
  id: string;
  label: string;
  modelName: string;
  promptText: string;
  status: PromptResult['status'];
  position: number | null;
  unverifiedReason: string | null;
  responseText: string | null;
  businessesNamed: string[];
  citations: string[];
  locationName: string;
  scannedAt: string;
}

/**
 * Render an assistant's answer, which arrives as markdown.
 *
 * Built as React nodes rather than injected HTML. The text is written by a
 * third-party model and reaches us through a vendor API, so it is untrusted
 * input by definition and must never go near dangerouslySetInnerHTML.
 *
 * Deliberately minimal: bold becomes bold, and markdown links collapse to their
 * label — the raw "([bbb.org](https://bbb.org/...?utm_source=openai))" that
 * ChatGPT appends to every line is noise to a customer, and the sources are
 * already listed separately below.
 */
function renderAnswer(text: string): React.ReactNode[] {
  // Strip markdown links first: [label](url) -> label
  const cleaned = text.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '$1');

  return cleaned.split(/(\*\*[^*]+\*\*)/g).map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return <strong key={i} className="font-semibold text-slate-900">{part.slice(2, -2)}</strong>;
    }
    return <span key={i}>{part}</span>;
  });
}

function AnswerModal({ id, onClose }: { id: string; onClose: () => void }) {
  const { data, isLoading } = useSWR<{ success: boolean; data: AnswerData }>(
    `/ai-visibility/answer/${id}`,
    fetcher,
  );
  const a = data?.data;

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/50 flex items-start sm:items-center justify-center p-4 overflow-y-auto"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Assistant answer"
    >
      <div
        className="bg-white rounded-2xl shadow-xl max-w-2xl w-full my-8 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-slate-100 flex items-start justify-between gap-4">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">
              What {a?.label ?? 'the assistant'} actually said
            </h3>
            {a && <p className="text-xs text-slate-400 mt-0.5">{a.modelName} · {fmtDate(a.scannedAt)}</p>}
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 text-xl leading-none" aria-label="Close">×</button>
        </div>

        {isLoading || !a ? (
          <div className="p-6 space-y-2">
            {[0, 1, 2, 3].map((i) => <div key={i} className="h-4 bg-slate-100 rounded animate-pulse" />)}
          </div>
        ) : (
          <div className="p-6 space-y-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-1.5">We asked</p>
              <p className="text-sm text-slate-700 italic">"{a.promptText}"</p>
            </div>

            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-1.5">It answered</p>
              {a.responseText ? (
                <div className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed bg-slate-50 rounded-lg p-4 max-h-96 overflow-y-auto">
                  {renderAnswer(a.responseText)}
                </div>
              ) : (
                <p className="text-sm text-slate-500 bg-slate-50 rounded-lg p-4">
                  No answer was recorded — {a.unverifiedReason ?? 'the assistant could not be reached'}.
                </p>
              )}
            </div>

            {a.citations.length > 0 && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-1.5">Sources it used</p>
                <div className="flex flex-wrap gap-1.5">
                  {a.citations.map((h) => (
                    <span key={h} className="text-xs px-2 py-1 rounded-md bg-slate-100 text-slate-600">{h}</span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ProTeaser({ title, body }: { title: string; body: string }) {
  return (
    <div className="bg-white rounded-xl shadow-card p-5 flex items-start justify-between gap-4">
      <div className="flex items-start gap-3">
        <Lock size={16} className="text-slate-400 shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-semibold text-slate-900">{title}</p>
          <p className="text-xs text-slate-500 mt-0.5">{body}</p>
        </div>
      </div>
      <Link
        to="/billing"
        className="shrink-0 bg-brand-500 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-brand-600 transition-colors"
      >
        Upgrade →
      </Link>
    </div>
  );
}

export default function AiVisibility() {
  const { data, error, isLoading } = useAiVisibility();
  const [openAnswer, setOpenAnswer] = useState<string | null>(null);

  const d = data?.data;
  const isPro = d?.plan === 'pro';

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-64 bg-slate-100 rounded animate-pulse" />
        <div className="h-40 bg-slate-100 rounded-xl animate-pulse" />
      </div>
    );
  }

  if (error) {
    return <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">Failed to load AI visibility. Please refresh.</div>;
  }

  if (!d?.scannedAt) {
    return (
      <div className="space-y-5">
        <header>
          <h1 className="text-xl font-bold text-slate-900">AI Visibility</h1>
          <p className="text-sm text-slate-500 mt-1">
            Whether ChatGPT, Claude, Gemini and Perplexity recommend you when someone asks.
          </p>
        </header>
        <div className="bg-white rounded-2xl shadow-card p-8 text-center">
          <Sparkles size={24} className="text-brand-500 mx-auto mb-3" />
          <p className="text-sm font-semibold text-slate-900">Your first check hasn't run yet</p>
          <p className="text-sm text-slate-500 mt-1">
            We check every Monday{d?.nextScanAt ? `, starting ${fmtDate(d.nextScanAt)}` : ''}.
          </p>
        </div>
      </div>
    );
  }

  const history = (d.history ?? []).filter((h) => h.mentionRate != null);

  return (
    <div className="space-y-5">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900">AI Visibility</h1>
          <p className="text-sm text-slate-500 mt-1">
            Whether ChatGPT, Claude, Gemini and Perplexity recommend you when someone asks.
            {' '}Checked {fmtDate(d.scannedAt)} · next {fmtDate(d.nextScanAt)}.
          </p>
        </div>
        {d.mentionRate != null && (
          <div className="shrink-0 text-right">
            <p className="text-3xl font-bold text-slate-900">{d.mentionRate}%</p>
            <p className="text-xs text-slate-400">of questions recommend you</p>
          </div>
        )}
      </header>

      {/* Per-question breakdown — the substance of the page */}
      <div className="space-y-3">
        {d.prompts.map((p) => (
          <div key={p.promptKey} className="bg-white rounded-xl shadow-card overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-100">
              <p className="text-sm font-medium text-slate-800">"{p.promptText}"</p>
              <p className="text-xs text-slate-400 mt-0.5">{p.intent}</p>
            </div>
            <div className="divide-y divide-slate-50">
              {p.results.map((r) => (
                <div key={r.snapshotId} className="px-5 py-3.5 flex items-center justify-between gap-4 flex-wrap">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="text-sm font-medium text-slate-700 w-24 shrink-0">{r.label}</span>
                    <StatusPill status={r.status} position={r.position} />
                  </div>

                  <div className="flex items-center gap-3 min-w-0">
                    {isPro && r.businessesNamed && r.businessesNamed.length > 0 && (
                      <span className="text-xs text-slate-400 truncate max-w-xs hidden md:inline">
                        named {r.businessesNamed.slice(0, 3).join(', ')}
                        {r.businessesNamed.length > 3 && ` +${r.businessesNamed.length - 3}`}
                      </span>
                    )}
                    {isPro && (
                      <button
                        onClick={() => setOpenAnswer(r.snapshotId)}
                        className="shrink-0 text-xs font-medium text-brand-600 hover:text-brand-700 inline-flex items-center gap-1"
                      >
                        See the answer <ExternalLink size={11} />
                      </button>
                    )}
                  </div>

                  {r.status === 'unverified' && r.unverifiedReason && (
                    <p className="w-full text-xs text-slate-400 pl-0 sm:pl-[7.5rem]">
                      {/* Already customer-facing and already says it is not
                          counted — the API translates the internal reason. */}
                      {r.unverifiedReason}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* ── Pro depth ────────────────────────────────────────────────────── */}
      {isPro ? (
        <>
          {history.length > 1 && (
            <div className="bg-white rounded-xl shadow-card p-5">
              <p className="text-sm font-semibold text-slate-900 mb-3">Recommendation rate over time</p>
              <div className="h-40">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={history.map((h) => ({ date: fmtDate(h.scannedAt), rate: h.mentionRate }))}>
                    <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                    <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} width={32} />
                    <Tooltip formatter={(v) => [`${v}%`, 'Recommended']} />
                    <Line type="monotone" dataKey="rate" stroke="#2563eb" strokeWidth={2} dot={{ r: 3 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="bg-white rounded-xl shadow-card p-5">
              <p className="text-sm font-semibold text-slate-900">Who the assistants name</p>
              <p className="text-xs text-slate-400 mt-0.5 mb-3">Across every question this week</p>
              {(d.topCompetitors ?? []).length === 0 ? (
                <p className="text-sm text-slate-400">No businesses were named.</p>
              ) : (
                <ul className="space-y-1.5">
                  {(d.topCompetitors ?? []).map((c) => (
                    <li key={c.name} className="flex items-center justify-between text-sm">
                      <span className="text-slate-700 truncate">{c.name}</span>
                      <span className="text-xs text-slate-400 shrink-0 ml-3">{c.timesNamed}×</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="bg-white rounded-xl shadow-card p-5">
              <p className="text-sm font-semibold text-slate-900">Where they get their answers</p>
              <p className="text-xs text-slate-400 mt-0.5 mb-3">
                These pages decide local recommendations — several are ones you can get listed on.
              </p>
              {(d.topSources ?? []).length === 0 ? (
                <p className="text-sm text-slate-400">No sources were cited.</p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {(d.topSources ?? []).map((s) => (
                    <span key={s.host} className="text-xs px-2 py-1 rounded-md bg-slate-100 text-slate-600">
                      {s.host} <span className="text-slate-400">{s.timesCited}×</span>
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      ) : (
        <div className="space-y-3">
          <ProTeaser
            title="See who the assistants recommend instead"
            body="Pro shows the competitors named in every answer, the sources each assistant trusted, and how your rate moves week to week."
          />
          <ProTeaser
            title="Read the actual answers"
            body="Pro keeps the full response behind every verdict, so you can see exactly what was said about your market."
          />
        </div>
      )}

      {openAnswer && <AnswerModal id={openAnswer} onClose={() => setOpenAnswer(null)} />}
    </div>
  );
}
