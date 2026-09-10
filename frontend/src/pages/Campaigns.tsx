import CampaignInvitationHistory from '../components/CampaignInvitationHistory';
import { InviteForm, BulkUpload } from '../components/CampaignInvitations';
import ReviewCollectionLinks from '../components/ReviewCollectionLinks';
import { useState } from 'react';
import useSWR from 'swr';
import { Mail, Upload, ChevronDown, ChevronUp, AlertCircle, UserX, Plus, X } from 'lucide-react';
import { fetcher } from '../services/api';
import CampaignSetupRequest from '../components/CampaignSetupRequest';
import EMRSetupBanner from '../components/EMRSetupBanner';

interface Campaign {
  id: string;
  emrCampaignId: string;
  name: string;
  invited: number | null;
  opened: number | null;
  clicked: number | null;
  reviewed: number | null;
  privateFeedback: number | null;
  unsubscribed: number | null;
  metricsPulledAt: string | null;
}

interface CampaignsResponse {
  success: boolean;
  data: { campaigns: Campaign[] };
}

interface Unsubscribe {
  contact: string;
  type: 'email' | 'sms';
  unsubscribedAt: string;
}

interface UnsubscribesResponse {
  success: boolean;
  data: { unsubscribes: Unsubscribe[]; total: number | null; hasMore: boolean; available: boolean; message?: string };
}

interface CreditsResponse {
  success: boolean;
  data: { email: number; sms: number; total: number; connected: boolean; available: boolean };
}

// ── Credit badge ────────────────────────────────────────────────────────────

function CreditBadge() {
  const { data } = useSWR<CreditsResponse>('/campaigns/credits', fetcher, { refreshInterval: 60_000 });
  const credits = data?.data;
  if (!credits?.available) return null;

  const isLow = credits.total < 50;
  const isCritical = credits.total < 20;

  return (
    <div className={`flex items-center gap-3 text-sm px-3 py-1.5 rounded-lg border ${
      isCritical ? 'bg-red-50 border-red-200 text-red-700' :
      isLow ? 'bg-amber-50 border-amber-200 text-amber-700' :
      'bg-slate-50 border-slate-200 text-slate-600'
    }`}>
      <span>📧 {credits.email}</span>
      <span>📱 {credits.sms}</span>
      {isLow && <span className="font-medium">{isCritical ? '⚠ Critical' : '⚠ Low'}</span>}
    </div>
  );
}

// Campaigns are provisioned in the vendor dashboard, not through its REST API.
function NewCampaignModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-labelledby="campaign-setup-title">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <h2 id="campaign-setup-title" className="font-semibold text-slate-900">Campaign setup</h2>
          <button onClick={onClose} aria-label="Close campaign setup" className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
        </div>
        <div className="px-5 py-5 space-y-4 text-sm text-slate-700">
          <p>Campaign setup is currently assisted. We will connect a feedback form and campaign to the correct business before you invite customers.</p>
          <p>Every customer must receive the same opportunity to leave an honest public review, regardless of rating. Ratings and private feedback can help organize your follow-up.</p>
          <CampaignSetupRequest />
        </div>
      </div>
    </div>
  );
}

// ── Funnel bar ─────────────────────────────────────────────────────────────

function ProviderMetric({ label, value }: { label: string; value: number | null }) {
  return <div className="flex justify-between gap-3 text-sm"><span className="text-slate-500">{label}</span><span className="font-medium text-slate-700">{value === null ? 'Unavailable' : value.toLocaleString()}</span></div>;
}

// ── Campaign card ───────────────────────────────────────────────────────────

function CampaignCard({ campaign }: { campaign: Campaign }) {
  const [expanded, setExpanded] = useState(false);
  const [tab, setTab] = useState<'single' | 'bulk'>('single');




  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-card overflow-hidden">
      <div
        className="flex items-center justify-between px-5 py-4 cursor-pointer hover:bg-slate-50 transition-colors"
        onClick={() => setExpanded((v) => !v)}
      >
        <div>
          <h3 className="font-semibold text-slate-900">{campaign.name}</h3>
          <p className="text-xs text-slate-400 mt-0.5">
            {campaign.invited?.toLocaleString() ?? "Unknown"} provider invitations

          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-500">Delivery unconfirmed</span>
          {expanded ? <ChevronUp size={16} className="text-slate-400" /> : <ChevronDown size={16} className="text-slate-400" />}
        </div>
      </div>

      {expanded && (
        <div className="px-5 pb-5 border-t border-slate-100 space-y-5">
          <p className="pt-4 text-xs text-slate-500">Provider activity is not verified delivery or a confirmed public review. Review actions may include clicks or form activity. Unavailable metrics are not zero.</p>
          <div className="pt-4 space-y-2">
            <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">Provider activity</h4>
            <ProviderMetric label="Invited" value={campaign.invited} />
            <ProviderMetric label="Opened" value={campaign.opened} />
            <ProviderMetric label="Clicked" value={campaign.clicked} />
            <ProviderMetric label="Review actions" value={campaign.reviewed} />
            <ProviderMetric label="Private feedback" value={campaign.privateFeedback} />
            <ProviderMetric label="Unsubscribed" value={campaign.unsubscribed} />
          </div>

          <div className="bg-blue-50 border border-blue-100 rounded-lg px-4 py-3 text-xs text-blue-800">
            <strong>How it works:</strong> Invite every customer to share an honest review, regardless of rating. Keep the public review option equally available to everyone. Review ratings and private feedback separately to identify follow-up needs.
          </div>

          {/* Send invites */}
          <div>
            <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">Send invites</h4>
            <div className="flex gap-3 mb-4">
              <button
                onClick={() => setTab('single')}
                className={`flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg transition-colors ${tab === 'single' ? 'bg-brand-50 text-brand-700 font-medium' : 'text-slate-500 hover:text-slate-700'}`}
              >
                <Mail size={14} /> Single
              </button>
              <button
                onClick={() => setTab('bulk')}
                className={`flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg transition-colors ${tab === 'bulk' ? 'bg-brand-50 text-brand-700 font-medium' : 'text-slate-500 hover:text-slate-700'}`}
              >
                <Upload size={14} /> Bulk CSV
              </button>
            </div>

            {tab === 'single' ? (
              <InviteForm
                campaignId={campaign.emrCampaignId}
                onSent={() => undefined}
              />
            ) : (
              <BulkUpload
                campaignId={campaign.emrCampaignId}
                onSent={() => undefined}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Unsubscribed section ────────────────────────────────────────────────────

function UnsubscribedSection() {
  const [expanded, setExpanded] = useState(false);
  const { data, error, isLoading } = useSWR<UnsubscribesResponse>('/campaigns/unsubscribes', fetcher);

  const unsubscribes = data?.data?.unsubscribes ?? [];
  const total = data?.data?.total ?? 0;

  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-card overflow-hidden">
      <div
        className="flex items-center justify-between px-5 py-4 cursor-pointer hover:bg-slate-50 transition-colors"
        onClick={() => setExpanded((v) => !v)}
      >
        <div className="flex items-center gap-2">
          <UserX size={16} className="text-slate-400" />
          <span className="font-semibold text-slate-900">
            Unsubscribed {total > 0 ? `(${total.toLocaleString()})` : ''}
          </span>
        </div>
        {expanded ? <ChevronUp size={16} className="text-slate-400" /> : <ChevronDown size={16} className="text-slate-400" />}
      </div>

      {expanded && (
        <div className="border-t border-slate-100">
          <div className="px-5 py-3 bg-blue-50 border-b border-blue-100 text-xs text-blue-800">
            The provider respects opt-outs when processing invitation requests. Acceptance does not confirm delivery; duplicate and opted-out contacts may be skipped.
          </div>

          {isLoading && (
            <div className="px-5 py-6 space-y-2">
              {[1, 2, 3].map((n) => (
                <div key={n} className="h-4 bg-slate-100 rounded animate-pulse" />
              ))}
            </div>
          )}

          {!isLoading && !error && data?.data.available && unsubscribes.length === 0 && (
            <div className="px-5 py-8 text-center text-sm text-slate-400">
              No unsubscribes returned.
            </div>
          )}

          {error && <p role="alert" className="p-5 text-sm text-red-600">Unable to check unsubscribe information.</p>}
          {!isLoading && data?.data.available === false && <p className="p-5 text-sm text-slate-600">{data.data.message}</p>}
          {!isLoading && unsubscribes.length > 0 && (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left">
                  <th className="px-5 py-2 text-xs font-semibold text-slate-400 uppercase tracking-wide">Contact</th>
                  <th className="px-5 py-2 text-xs font-semibold text-slate-400 uppercase tracking-wide">Date Unsubscribed</th>
                </tr>
              </thead>
              <tbody>
                {unsubscribes.map((u, i) => (
                  <tr key={i} className="border-b border-slate-50 last:border-0">
                    <td className="px-5 py-2.5 text-slate-700 font-mono text-xs">{u.contact}</td>
                    <td className="px-5 py-2.5 text-slate-500 text-xs">
                      {new Date(u.unsubscribedAt).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

// ── Page ────────────────────────────────────────────────────────────────────

export default function Campaigns() {
  const { data, error, isLoading } = useSWR<CampaignsResponse>('/campaigns', fetcher);
  const { data: creditsData } = useSWR<CreditsResponse>('/campaigns/credits', fetcher, { refreshInterval: 60_000 });
  const [showNewCampaign, setShowNewCampaign] = useState(false);

  const campaigns = data?.data?.campaigns ?? [];
  const credits = creditsData?.data;

  if (error) {
    return (
      <div className="flex items-center gap-2 text-red-600 text-sm mt-8 justify-center">
        <AlertCircle size={16} /> Failed to load campaigns
      </div>
    );
  }

  // A connection prompt is useful when there is no campaign, without a second login.
  const showEMRBanner = !isLoading && campaigns.length === 0;

  return (
    <div className="space-y-6">
      {showEMRBanner && <EMRSetupBanner context="campaigns" />}
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-bold text-slate-900">Review Campaigns</h1>
            <CreditBadge />
          </div>
          <button
            onClick={() => setShowNewCampaign(true)}
            className="whitespace-nowrap inline-flex items-center gap-2 px-1.5 py-1 text-xs sm:px-4 sm:py-2 sm:text-sm font-medium text-white bg-brand-500 hover:bg-brand-600 rounded-lg transition-colors"
          >
            <Plus size={14} /> Campaign setup
          </button>
        </div>
        <p className="text-sm text-slate-500">
          Invite customers to share an honest review. Use ratings and private feedback to organize follow-up without restricting who can review publicly.
        </p>
        {credits?.available && credits.total < 50 && (
          <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
            You're running low on review request credits ({credits.total} remaining). Contact support to top up.
          </div>
        )}
      </div>

      <ReviewCollectionLinks />
      <CampaignInvitationHistory />

      {isLoading && (
        <div className="space-y-3">
          {[1, 2].map((n) => (
            <div key={n} className="bg-white border border-slate-200 rounded-xl h-20 animate-pulse" />
          ))}
        </div>
      )}

      {!isLoading && campaigns.length === 0 && (
        <div className="bg-white border border-slate-200 rounded-xl p-8 text-center">
          <Mail size={32} className="mx-auto text-slate-300 mb-3" />
          <h3 className="font-semibold text-slate-700 mb-1">No campaigns yet</h3>
          <p className="text-sm text-slate-400">
            {credits?.connected === false
              ? 'Connect your Google Business Profile in Settings → Integrations to get started.'
              : 'Choose "Campaign setup" above to arrange your first review request campaign.'}
          </p>
        </div>
      )}

      {campaigns.map((c) => (
        <CampaignCard key={c.id} campaign={c} />
      ))}

      <UnsubscribedSection />

      {showNewCampaign && <NewCampaignModal onClose={() => setShowNewCampaign(false)} />}
    </div>
  );
}
