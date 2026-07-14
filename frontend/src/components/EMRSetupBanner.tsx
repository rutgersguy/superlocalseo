import { Star, ArrowUpRight, X } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';

const DISMISS_KEY = 'emr_setup_banner_dismissed';

interface Props {
  context: 'reviews' | 'campaigns';
}

/**
 * Prompts a client to connect their Google Business Profile when they have no reviews or
 * campaigns yet.
 *
 * This used to hand out review-portal credentials and tell the client to link their profiles
 * inside that portal. That was a dead end: a profile connected there attaches to the client's
 * EMR SUB-ACCOUNT organization, and our agency API key cannot read a sub-account's data — so
 * they would connect Google and still see nothing here, forever.
 *
 * Connecting now happens in Settings → Integrations, which mints an EMR connect-link against
 * OUR location — the data we actually read. See GoogleConnectCard.
 */
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
        <p className="text-sm font-semibold text-amber-900">Connect your Google Business Profile</p>
        <p className="text-xs text-amber-700 mt-0.5 leading-relaxed">
          {context === 'campaigns'
            ? 'Connect Google so we can send review requests and track who leaves a review. Happy customers go to Google; unhappy ones are routed to a private feedback form.'
            : "Connect Google and we'll pull in your reviews automatically — and let you reply to them right from this page."}
        </p>
        <Link
          to="/dashboard/settings?tab=integrations"
          className="inline-flex items-center gap-1.5 mt-3 px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold rounded-lg transition-colors"
        >
          Connect Google
          <ArrowUpRight className="w-3.5 h-3.5" />
        </Link>
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
