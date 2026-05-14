import { Star, ArrowUpRight, X } from 'lucide-react';
import { useState } from 'react';

const EMR_URL = 'https://app.superlocalseo.com';
const DISMISS_KEY = 'emr_setup_banner_dismissed';

interface Props {
  context: 'reviews' | 'campaigns';
}

export default function EMRSetupBanner({ context }: Props) {
  const [dismissed, setDismissed] = useState(() => {
    try { return localStorage.getItem(DISMISS_KEY) === '1'; } catch { return false; }
  });

  if (dismissed) return null;

  const dismiss = () => {
    try { localStorage.setItem(DISMISS_KEY, '1'); } catch { /* */ }
    setDismissed(true);
  };

  return (
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
        <a
          href={EMR_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 mt-3 px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold rounded-lg transition-colors"
        >
          Open Review Management
          <ArrowUpRight className="w-3.5 h-3.5" />
        </a>
      </div>

      <button
        onClick={dismiss}
        className="flex-shrink-0 text-amber-400 hover:text-amber-600 transition-colors p-0.5"
        aria-label="Dismiss"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
