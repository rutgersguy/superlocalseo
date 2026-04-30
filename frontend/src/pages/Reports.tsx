import { useState } from 'react';
import useSWR from 'swr';
import { fetcher, apiFetch } from '../services/api';

// ─── Types ─────────────────────────────────────────────────────────────────────

interface Report {
  id: string;
  periodMonth: number;
  periodYear: number;
  status: 'pending' | 'generating' | 'generated' | 'sent' | 'failed';
  generatedAt: string | null;
  sentAt: string | null;
  emailRecipient: string | null;
}

interface ReportsResponse {
  success: boolean;
  data: Report[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function formatPeriod(month: number, year: number): string {
  return `${MONTH_NAMES[month - 1]} ${year}`;
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function StatusBadge({ status }: { status: Report['status'] }) {
  const styles: Record<Report['status'], string> = {
    pending: 'bg-gray-100 text-gray-600',
    generating: 'bg-yellow-100 text-yellow-700',
    generated: 'bg-blue-100 text-blue-700',
    sent: 'bg-green-100 text-green-700',
    failed: 'bg-red-100 text-red-700',
  };
  const labels: Record<Report['status'], string> = {
    pending: 'Pending',
    generating: 'Generating',
    generated: 'Generated',
    sent: 'Sent',
    failed: 'Failed',
  };
  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${styles[status]}`}>
      {labels[status]}
    </span>
  );
}

// ─── Generate Modal ───────────────────────────────────────────────────────────

interface GenerateModalProps {
  onClose: () => void;
  onSuccess: () => void;
  initialMonth?: number;
  initialYear?: number;
}

function GenerateModal({ onClose, onSuccess, initialMonth, initialYear }: GenerateModalProps) {
  const now = new Date();
  const defaultMonth = initialMonth ?? (now.getMonth() === 0 ? 12 : now.getMonth());
  const defaultYear = initialYear ?? (now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear());

  const [month, setMonth] = useState<number>(defaultMonth);
  const [year, setYear] = useState<number>(defaultYear);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [toastError, setToastError] = useState(false);

  const currentYear = now.getFullYear();
  const years: number[] = [];
  for (let y = currentYear; y >= currentYear - 3; y--) years.push(y);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setToast(null);
    try {
      const res = await apiFetch<{ success: boolean; data: { queued: boolean; jobId: string } }>(
        '/reports/generate',
        {
          method: 'POST',
          body: JSON.stringify({ month, year }),
        },
      );
      if (res.success && res.data.queued) {
        setToast('Report queued successfully! It will be emailed when ready.');
        setToastError(false);
        setTimeout(() => {
          onSuccess();
          onClose();
        }, 1800);
      } else {
        setToast('Failed to queue report. Please try again.');
        setToastError(true);
      }
    } catch {
      setToast('An error occurred. Please try again.');
      setToastError(true);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      role="dialog"
      aria-modal="true"
      aria-label="Generate report"
    >
      <div className="bg-white rounded-xl shadow-xl w-full max-w-sm mx-4 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Generate Report</h2>

        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="modal-month">
              Month
            </label>
            <select
              id="modal-month"
              value={month}
              onChange={(e) => setMonth(Number(e.target.value))}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            >
              {MONTH_NAMES.map((name, i) => (
                <option key={name} value={i + 1}>{name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="modal-year">
              Year
            </label>
            <select
              id="modal-year"
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            >
              {years.map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>

          {toast && (
            <div
              className={`p-3 rounded-lg text-sm ${
                toastError
                  ? 'bg-red-50 border border-red-200 text-red-700'
                  : 'bg-green-50 border border-green-200 text-green-700'
              }`}
            >
              {toast}
            </div>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-900 rounded-lg hover:bg-gray-100 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-4 py-2 text-sm font-medium text-white bg-brand-500 hover:bg-brand-600 rounded-lg transition-colors disabled:opacity-60"
            >
              {loading ? 'Queuing…' : 'Generate'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function SkeletonRow() {
  return (
    <tr className="animate-pulse">
      {[1, 2, 3, 4].map((i) => (
        <td key={i} className="px-4 py-3">
          <div className="h-4 bg-gray-200 rounded w-3/4" />
        </td>
      ))}
      <td className="px-4 py-3">
        <div className="flex gap-2">
          <div className="h-7 bg-gray-200 rounded w-20" />
          <div className="h-7 bg-gray-200 rounded w-16" />
        </div>
      </td>
    </tr>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function Reports() {
  const [modalOpen, setModalOpen] = useState(false);
  const [resendModal, setResendModal] = useState<{ month: number; year: number } | null>(null);

  const { data, isLoading, error, mutate } = useSWR<ReportsResponse>('/reports', fetcher, {
    refreshInterval: 15_000,
  });

  const reports = data?.data ?? [];

  function openResend(report: Report) {
    setResendModal({ month: report.periodMonth, year: report.periodYear });
  }

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Reports</h1>
          <p className="text-sm text-gray-500 mt-1">
            Monthly PDF reports are generated automatically on the 1st of each month.
          </p>
        </div>
        <button
          onClick={() => setModalOpen(true)}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-brand-500 hover:bg-brand-600 rounded-lg transition-colors shadow-sm"
        >
          <span aria-hidden="true">+</span>
          Generate Report
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          Failed to load reports. Please refresh.
        </div>
      )}

      {/* Table card */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-100">
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                Period
              </th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                Status
              </th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                Generated
              </th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                Sent to
              </th>
              <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {isLoading ? (
              <>
                <SkeletonRow />
                <SkeletonRow />
                <SkeletonRow />
              </>
            ) : reports.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-16 text-center">
                  <p className="text-gray-400 text-sm">
                    No reports yet. Reports are generated automatically on the 1st of each month.
                  </p>
                  <button
                    onClick={() => setModalOpen(true)}
                    className="mt-4 text-sm text-brand-500 hover:text-brand-600 font-medium underline underline-offset-2"
                  >
                    Generate your first report
                  </button>
                </td>
              </tr>
            ) : (
              reports.map((report) => (
                <tr key={report.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3 text-sm font-medium text-gray-900">
                    {formatPeriod(report.periodMonth, report.periodYear)}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={report.status} />
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500">
                    {formatDate(report.generatedAt)}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500">
                    {report.emailRecipient ?? '—'}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-2">
                      {(report.status === 'generated' || report.status === 'sent') && (
                        <a
                          href={`/api/reports/${report.id}/download`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-brand-600 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors"
                        >
                          Download
                        </a>
                      )}
                      <button
                        onClick={() => openResend(report)}
                        className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
                      >
                        Re-send
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Generate modal */}
      {modalOpen && (
        <GenerateModal
          onClose={() => setModalOpen(false)}
          onSuccess={() => void mutate()}
        />
      )}

      {/* Re-send modal */}
      {resendModal && (
        <GenerateModal
          initialMonth={resendModal.month}
          initialYear={resendModal.year}
          onClose={() => setResendModal(null)}
          onSuccess={() => { setResendModal(null); void mutate(); }}
        />
      )}
    </div>
  );
}
