import { Lock } from 'lucide-react';
import { Link } from 'react-router-dom';

interface ProGateProps {
  feature: string;
  description: string;
}

/** Locked-feature placeholder shown to Lite users on Pro-only pages. */
export function ProGate({ feature, description }: ProGateProps) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-10 text-center max-w-md mx-auto mt-12">
      <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-slate-100 mb-4">
        <Lock className="w-5 h-5 text-slate-400" />
      </div>
      <p className="font-semibold text-slate-800 mb-1 text-base">{feature} is a Pro feature</p>
      <p className="text-sm text-slate-500 mb-5">{description}</p>
      <Link
        to="/billing?upgrade=1"
        className="inline-flex items-center gap-1.5 px-5 py-2.5 bg-brand-500 text-white text-sm font-semibold rounded-lg hover:bg-brand-600 transition-colors"
      >
        Upgrade to Pro →
      </Link>
    </div>
  );
}
