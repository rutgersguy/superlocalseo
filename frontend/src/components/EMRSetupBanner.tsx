import { Star, ArrowUpRight, X, Copy, Check, Loader } from 'lucide-react';
import { useState } from 'react';
import useSWR from 'swr';
import { fetcher } from '../services/api';

const EMR_URL = 'https://app.superlocalseo.com/login';
const DISMISS_KEY = 'emr_setup_banner_dismissed';

interface Credentials {
  ready: boolean;
  loginUrl: string;
  email: string | null;
  password: string | null;
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button onClick={() => void copy()} className="ml-2 text-amber-600 hover:text-amber-800 transition-colors">
      {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  );
}

function CredentialsModal({ onClose }: { onClose: () => void }) {
  const { data, isLoading } = useSWR<{ success: boolean; data: Credentials }>('/clients/emr-credentials', fetcher);
  const creds = data?.data;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <h2 className="font-semibold text-slate-900">Review Management Login</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-5 space-y-4">
          {isLoading && (
            <div className="flex items-center justify-center py-6 text-slate-400">
              <Loader className="w-5 h-5 animate-spin" />
            </div>
          )}

          {!isLoading && !creds?.ready && (
            <div className="text-sm text-slate-500 text-center py-4">
              Your review management account is still being set up. Try again in a moment.
            </div>
          )}

          {!isLoading && creds?.ready && (
            <>
              <p className="text-sm text-slate-600">
                Your review management account is ready. Use these credentials to log in and connect your Google, Yelp, and other review profiles.
              </p>

              <div className="space-y-3 bg-slate-50 rounded-lg p-4">
                <div>
                  <p className="text-xs font-medium text-slate-500 mb-1">Login URL</p>
                  <div className="flex items-center">
                    <span className="text-sm text-slate-800 font-mono">{creds.loginUrl}</span>
                    <CopyButton value={creds.loginUrl} />
                  </div>
                </div>
                <div>
                  <p className="text-xs font-medium text-slate-500 mb-1">Email</p>
                  <div className="flex items-center">
                    <span className="text-sm text-slate-800 font-mono">{creds.email}</span>
                    <CopyButton value={creds.email!} />
                  </div>
                </div>
                <div>
                  <p className="text-xs font-medium text-slate-500 mb-1">Password</p>
                  <div className="flex items-center">
                    <span className="text-sm text-slate-800 font-mono">{creds.password}</span>
                    <CopyButton value={creds.password!} />
                  </div>
                </div>
              </div>

              <p className="text-xs text-slate-400">
                You can change your password after logging in. Save these somewhere safe.
              </p>
            </>
          )}
        </div>

        <div className="px-5 pb-5 flex gap-3">
          <button onClick={onClose} className="flex-1 px-4 py-2 text-sm text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50">
            Close
          </button>
          {creds?.ready && (
            <a
              href={EMR_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 inline-flex items-center justify-center gap-1.5 px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white text-sm font-semibold rounded-lg transition-colors"
            >
              Open Review Management <ArrowUpRight className="w-3.5 h-3.5" />
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

interface Props {
  context: 'reviews' | 'campaigns';
}

export default function EMRSetupBanner({ context }: Props) {
  const [dismissed, setDismissed] = useState(() => {
    try { return localStorage.getItem(DISMISS_KEY) === '1'; } catch { return false; }
  });
  const [showModal, setShowModal] = useState(false);

  if (dismissed) return null;

  const dismiss = () => {
    try { localStorage.setItem(DISMISS_KEY, '1'); } catch { /* */ }
    setDismissed(true);
  };

  return (
    <>
      {showModal && <CredentialsModal onClose={() => setShowModal(false)} />}

      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 flex items-start gap-4">
        <div className="flex-shrink-0 mt-0.5 w-9 h-9 rounded-lg bg-amber-100 flex items-center justify-center">
          <Star className="w-4 h-4 text-amber-600" />
        </div>

        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-amber-900">
            {context === 'campaigns'
              ? 'Set up your review request campaigns'
              : 'Connect your review profiles to start collecting reviews'}
          </p>
          <p className="text-xs text-amber-700 mt-0.5 leading-relaxed">
            {context === 'campaigns'
              ? 'Create campaigns in your Review Management dashboard to send review requests by email or SMS. Happy customers go to Google; others get routed to a private feedback form.'
              : 'Link your Google, Facebook, and other profiles in your Review Management dashboard so we can monitor and display your reviews here.'}
          </p>
          <button
            onClick={() => setShowModal(true)}
            className="inline-flex items-center gap-1.5 mt-3 px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold rounded-lg transition-colors"
          >
            Set Up Review Management
            <ArrowUpRight className="w-3.5 h-3.5" />
          </button>
        </div>

        <button
          onClick={dismiss}
          className="flex-shrink-0 text-amber-400 hover:text-amber-600 transition-colors p-0.5"
          aria-label="Dismiss"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </>
  );
}
