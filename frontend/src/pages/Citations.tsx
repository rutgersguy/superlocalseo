import { useState, useEffect, useRef } from 'react';
import useSWR, { mutate } from 'swr';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { fetcher, apiFetch } from '../services/api';
import { useAuth } from '../hooks/useAuth';

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
  listedCount: number;
  totalCount: number;
  completeness: number;
}

interface TrendResponse {
  success: boolean;
  data: { history: TrendPoint[] };
}

type TrendDays = 30 | 90;
type CitationsTab = 'directories' | 'submissions';

const TREND_RANGES: { label: string; value: TrendDays }[] = [
  { label: '30d', value: 30 },
  { label: '90d', value: 90 },
];

interface SubmissionRow {
  id: string;
  locationId: string;
  directory: string;
  status: 'pending' | 'submitted' | 'live' | 'rejected' | 'duplicate';
  listingUrl: string | null;
  rejectionReason: string | null;
  submittedAt: string;
  liveAt: string | null;
}
interface SubmissionsResponse { success: boolean; data: { submissions: SubmissionRow[] }; }

interface LocationOption { id: string; name: string; city?: string; state?: string; }
interface LocationsResponse { success: boolean; data: LocationOption[]; }

interface LookupCitation {
  domain: string;
  profileUrl: string;
  nap: { name?: string; address?: string; phone?: string };
}

interface LookupResponse {
  success: boolean;
  data: {
    lookupStatus: 'complete' | 'processing';
    lookupCompletedAt: string | null;
    citations: LookupCitation[];
  };
}

const DIRECTORY_NAMES: Record<string, string> = {
  google:        'Google Business Profile',
  bing:          'Bing Places',
  apple:         'Apple Maps',
  yelp:          'Yelp',
  facebook:      'Facebook',
  bbb:           'Better Business Bureau',
  yellowpages:   'Yellow Pages',
  foursquare:    'Foursquare',
  nextdoor:      'Nextdoor',
  manta:         'Manta',
  merchantcircle:'Merchant Circle',
  trustpilot:    'Trustpilot',
  linkedin:      'LinkedIn',
  tripadvisor:   'TripAdvisor',
  angi:          'Angi',
  houzz:         'Houzz',
  thumbtack:     'Thumbtack',
  porch:         'Porch',
  homeadvisor:   'HomeAdvisor',
  bark:          'Bark',
  healthgrades:  'Healthgrades',
  zocdoc:        'ZocDoc',
  webmd:         'WebMD',
  vitals:        'Vitals',
  ratemds:       'RateMDs',
  avvo:          'Avvo',
  justia:        'Justia',
  findlaw:       'FindLaw',
  lawyers:       'Lawyers.com',
  opentable:     'OpenTable',
  zomato:        'Zomato',
  happycow:      'HappyCow',
  vagaro:        'Vagaro',
  mindbody:      'Mindbody',
  styleseat:     'StyleSeat',
  repairpal:     'RepairPal',
  carwise:       'CarWise',
  expertise:     'Expertise.com',
  zoominfo:      'ZoomInfo',
  zillow:        'Zillow',
  realtor:       'Realtor.com',
  trulia:        'Trulia',
};

function directoryDisplayName(key: string): string {
  return DIRECTORY_NAMES[key.toLowerCase()] ?? key.charAt(0).toUpperCase() + key.slice(1);
}

const DIRECTORY_PRIORITY: Record<string, number> = {
  google: 0, yelp: 1, facebook: 2, bing: 3, apple: 4,
  yellowpages: 5, bbb: 6, foursquare: 7, nextdoor: 8, trustpilot: 9,
  linkedin: 10, manta: 11, merchantcircle: 12,
  tripadvisor: 13, houzz: 14, angi: 15, thumbtack: 16, homeadvisor: 17,
  porch: 18, bark: 19, healthgrades: 20, zocdoc: 21, webmd: 22,
  avvo: 23, justia: 24, findlaw: 25, zillow: 26,
};

function sortDirectories<T extends { name: string }>(dirs: T[]): T[] {
  return [...dirs].sort((a, b) => {
    const pa = DIRECTORY_PRIORITY[a.name.toLowerCase()] ?? 999;
    const pb = DIRECTORY_PRIORITY[b.name.toLowerCase()] ?? 999;
    if (pa !== pb) return pa - pb;
    return a.name.localeCompare(b.name);
  });
}

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-gray-100 text-gray-600',
  submitted: 'bg-blue-100 text-blue-700',
  live: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-600',
  duplicate: 'bg-yellow-100 text-yellow-700',
};

const CB_PACKAGES: { id: string; label: string; count: number; note?: string }[] = [
  { id: 'cb0',   label: 'Aggregators only', count: 0, note: 'No individual directories' },
  { id: 'cb10',  label: '10 citations',  count: 10 },
  { id: 'cb15',  label: '15 citations',  count: 15 },
  { id: 'cb25',  label: '25 citations',  count: 25 },
  { id: 'cb30',  label: '30 citations',  count: 30 },
  { id: 'cb50',  label: '50 citations',  count: 50 },
  { id: 'cb75',  label: '75 citations',  count: 75 },
  { id: 'cb100', label: '100 citations', count: 100 },
];

const CB_PUBLISHERS: { id: string; label: string }[] = [
  { id: 'dataaxle',   label: 'Data Axle' },
  { id: 'neustar',    label: 'Neustar' },
  { id: 'foursquare', label: 'Foursquare' },
  { id: 'ypnetwork',  label: 'YP Network' },
  { id: 'gpsnetwork', label: 'GPS Network' },
];

// ─── Icon helpers ─────────────────────────────────────────────────────────────

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

function Spinner({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <svg className={`${className} animate-spin text-brand-600`} fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
    </svg>
  );
}

function hasNapError(dir: Directory): boolean {
  if (!dir.listed) return false;
  const d = dir.napDetail;
  if (!d) return false;
  return d.nameMatch === false || d.addressMatch === false || d.phoneMatch === false;
}

// ─── Citation Builder Wizard ──────────────────────────────────────────────────

type WizardStep = 'location' | 'creating' | 'lookup' | 'configure' | 'done';

interface CitationBuilderModalProps {
  locations: LocationOption[];
  onClose: () => void;
  onDone: () => void;
}

function CitationBuilderModal({ locations, onClose, onDone }: CitationBuilderModalProps) {
  const [step, setStep] = useState<WizardStep>(locations.length === 1 ? 'creating' : 'location');
  const [locationId, setLocationId] = useState<string>(locations.length === 1 ? locations[0]!.id : '');
  const [campaignId, setCampaignId] = useState<string | null>(null);
  const [lookupCitations, setLookupCitations] = useState<LookupCitation[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Configure step state
  const [packageId, setPackageId] = useState<string>('cb25');
  const [selectedDomains, setSelectedDomains] = useState<Set<string>>(new Set());
  const [selectedPublishers, setSelectedPublishers] = useState<Set<string>>(
    new Set(['dataaxle', 'neustar', 'foursquare', 'ypnetwork', 'gpsnetwork']),
  );
  const [removeDuplicates, setRemoveDuplicates] = useState(true);
  const [confirming, setConfirming] = useState(false);

  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const createCampaign = async (locId: string) => {
    setError(null);
    setStep('creating');
    try {
      const res = await apiFetch<{ success: boolean; data: { campaignId: string } }>('/citations/campaign', {
        method: 'POST',
        body: JSON.stringify({ locationId: locId }),
      });
      setCampaignId(res.data.campaignId);
      setStep('lookup');
    } catch (e) {
      setError((e as Error).message ?? 'Failed to create campaign');
      setStep('location');
    }
  };

  // Auto-create when step jumps straight to 'creating' (single location)
  useEffect(() => {
    if (step === 'creating' && locationId) {
      void createCampaign(locationId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Poll lookup until complete
  useEffect(() => {
    if (step !== 'lookup' || !campaignId) return;

    const poll = async () => {
      try {
        const res = await apiFetch<LookupResponse>(`/citations/campaign/${encodeURIComponent(campaignId)}/lookup`);
        if (res.data.lookupStatus === 'complete') {
          const citations = res.data.citations;
          setLookupCitations(citations);
          setSelectedDomains(new Set(citations.map((c) => c.domain)));
          setStep('configure');
          return;
        }
      } catch {
        // keep polling
      }
      pollRef.current = setTimeout(poll, 4000);
    };

    void poll();
    return () => { if (pollRef.current) clearTimeout(pollRef.current); };
  }, [step, campaignId]);

  const handleConfirm = async () => {
    if (!campaignId || !locationId) return;
    setConfirming(true);
    setError(null);
    try {
      await apiFetch('/citations/campaign/' + encodeURIComponent(campaignId) + '/confirm', {
        method: 'POST',
        body: JSON.stringify({
          packageId,
          citations: Array.from(selectedDomains),
          publishers: Array.from(selectedPublishers),
          autoSelect: false,
          removeDuplicates,
          express: false,
          locationId,
        }),
      });
      await mutate('/citations/submissions');
      setStep('done');
    } catch (e) {
      setError((e as Error).message ?? 'Confirmation failed');
    } finally {
      setConfirming(false);
    }
  };

  const toggleDomain = (domain: string) => {
    setSelectedDomains((s) => {
      const n = new Set(s);
      if (n.has(domain)) n.delete(domain); else n.add(domain);
      return n;
    });
  };

  const togglePublisher = (pub: string) => {
    setSelectedPublishers((s) => {
      const n = new Set(s);
      if (n.has(pub)) n.delete(pub); else n.add(pub);
      return n;
    });
  };

  const selectedPkg = CB_PACKAGES.find((p) => p.id === packageId);
  const overLimit = selectedPkg && selectedPkg.count > 0 && selectedDomains.size > selectedPkg.count;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col">

        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between flex-shrink-0">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Citation Builder</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              {step === 'location' && 'Select a location'}
              {step === 'creating' && 'Creating campaign…'}
              {step === 'lookup' && 'Looking up existing citations…'}
              {step === 'configure' && `${lookupCitations.length} opportunities found — configure your submission`}
              {step === 'done' && 'Campaign confirmed'}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl font-bold leading-none">×</button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">

          {/* Step: location picker */}
          {step === 'location' && (
            <div className="p-6 space-y-3">
              {error && <div className="p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">{error}</div>}
              <p className="text-sm text-gray-600 mb-2">Which location do you want to build citations for?</p>
              {locations.map((loc) => (
                <button
                  key={loc.id}
                  onClick={() => setLocationId(loc.id)}
                  className={`w-full text-left px-4 py-3 rounded-lg border transition-colors ${
                    locationId === loc.id
                      ? 'border-brand-500 bg-brand-50 text-brand-800'
                      : 'border-gray-200 hover:border-gray-300 text-gray-700'
                  }`}
                >
                  <span className="font-medium text-sm">{loc.name}</span>
                  {(loc.city || loc.state) && (
                    <span className="text-xs text-gray-400 ml-2">{[loc.city, loc.state].filter(Boolean).join(', ')}</span>
                  )}
                </button>
              ))}
            </div>
          )}

          {/* Step: creating / lookup spinner */}
          {(step === 'creating' || step === 'lookup') && (
            <div className="p-12 flex flex-col items-center justify-center gap-4">
              <Spinner className="w-10 h-10" />
              <p className="text-sm text-gray-500">
                {step === 'creating' ? 'Setting up your campaign…' : 'Scanning citation opportunities — this can take a minute…'}
              </p>
            </div>
          )}

          {/* Step: configure */}
          {step === 'configure' && (
            <div className="divide-y divide-gray-100">

              {/* Package */}
              <div className="px-6 py-4">
                <h3 className="text-sm font-semibold text-gray-800 mb-3">Package</h3>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {CB_PACKAGES.map((pkg) => (
                    <button
                      key={pkg.id}
                      onClick={() => setPackageId(pkg.id)}
                      className={`px-3 py-2.5 rounded-lg border text-left transition-colors ${
                        packageId === pkg.id
                          ? 'border-brand-500 bg-brand-50 text-brand-800'
                          : 'border-gray-200 hover:border-gray-300 text-gray-700'
                      }`}
                    >
                      <div className="text-sm font-medium">{pkg.label}</div>
                      {pkg.note && <div className="text-xs text-gray-400 mt-0.5">{pkg.note}</div>}
                    </button>
                  ))}
                </div>
                {overLimit && (
                  <p className="text-xs text-amber-600 mt-2">
                    You've selected {selectedDomains.size} directories but the package includes {selectedPkg.count}. Deselect some or choose a larger package.
                  </p>
                )}
              </div>

              {/* Directories */}
              {lookupCitations.length > 0 && packageId !== 'cb0' && (
                <div className="px-6 py-4">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-semibold text-gray-800">
                      Directories
                      <span className="ml-2 text-xs font-normal text-gray-400">{selectedDomains.size} selected</span>
                    </h3>
                    <div className="flex gap-2 text-xs">
                      <button onClick={() => setSelectedDomains(new Set(lookupCitations.map((c) => c.domain)))} className="text-brand-600 hover:underline">All</button>
                      <button onClick={() => setSelectedDomains(new Set())} className="text-gray-400 hover:underline">None</button>
                    </div>
                  </div>
                  <div className="max-h-48 overflow-y-auto space-y-0.5 pr-1">
                    {lookupCitations.map((c) => (
                      <label key={c.domain} className="flex items-center gap-3 px-2 py-1.5 rounded hover:bg-gray-50 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={selectedDomains.has(c.domain)}
                          onChange={() => toggleDomain(c.domain)}
                          className="rounded border-gray-300 text-brand-600"
                        />
                        <span className="text-sm text-gray-700 flex-1">{c.domain}</span>
                        {c.profileUrl && (
                          <a href={c.profileUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-400 hover:underline flex-shrink-0">↗</a>
                        )}
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {/* Aggregator publishers */}
              <div className="px-6 py-4">
                <h3 className="text-sm font-semibold text-gray-800 mb-1">Aggregator networks</h3>
                <p className="text-xs text-gray-400 mb-3">Pushes your NAP data to hundreds of downstream directories.</p>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {CB_PUBLISHERS.map((pub) => (
                    <label key={pub.id} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedPublishers.has(pub.id)}
                        onChange={() => togglePublisher(pub.id)}
                        className="rounded border-gray-300 text-brand-600"
                      />
                      <span className="text-sm text-gray-700">{pub.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Options */}
              <div className="px-6 py-4">
                <h3 className="text-sm font-semibold text-gray-800 mb-3">Options</h3>
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={removeDuplicates}
                    onChange={(e) => setRemoveDuplicates(e.target.checked)}
                    className="rounded border-gray-300 text-brand-600"
                  />
                  <div>
                    <span className="text-sm text-gray-700">Remove duplicates</span>
                    <p className="text-xs text-gray-400">BrightLocal will clean up existing duplicate listings.</p>
                  </div>
                </label>
              </div>

              {error && (
                <div className="px-6 py-3">
                  <div className="p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">{error}</div>
                </div>
              )}
            </div>
          )}

          {/* Step: done */}
          {step === 'done' && (
            <div className="p-12 text-center space-y-3">
              <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mx-auto">
                <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <p className="text-gray-900 font-semibold">Campaign confirmed</p>
              <p className="text-sm text-gray-500">
                Your citations have been submitted. Track progress in the Submissions tab — it can take days to weeks for listings to go live.
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3 flex-shrink-0">
          {step === 'done' ? (
            <button onClick={() => { onDone(); onClose(); }}
              className="px-4 py-2 text-sm font-medium bg-brand-600 text-white rounded-lg hover:bg-brand-700">
              View Submissions
            </button>
          ) : step === 'location' ? (
            <>
              <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50">Cancel</button>
              <button
                disabled={!locationId}
                onClick={() => void createCampaign(locationId)}
                className="px-4 py-2 text-sm font-medium bg-brand-600 text-white rounded-lg hover:bg-brand-700 disabled:opacity-50"
              >
                Continue
              </button>
            </>
          ) : step === 'configure' ? (
            <>
              <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50">Cancel</button>
              <button
                disabled={confirming || !!overLimit || (packageId !== 'cb0' && selectedDomains.size === 0 && selectedPublishers.size === 0)}
                onClick={() => void handleConfirm()}
                className="px-4 py-2 text-sm font-medium bg-brand-600 text-white rounded-lg hover:bg-brand-700 disabled:opacity-50 flex items-center gap-2"
              >
                {confirming && <Spinner className="w-4 h-4" />}
                Confirm &amp; Submit
              </button>
            </>
          ) : (
            <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50">Cancel</button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function Citations() {
  const { role } = useAuth();
  const isAdmin = role === 'admin';

  const [trendDays, setTrendDays] = useState<TrendDays>(90);
  const [expandedDir, setExpandedDir] = useState<string | null>(null);
  const [showErrorsOnly, setShowErrorsOnly] = useState(false);
  const [activeTab, setActiveTab] = useState<CitationsTab>('directories');
  const [showBuilder, setShowBuilder] = useState(false);

  const { data, isLoading, error } = useSWR<CitationsResponse>('/citations', fetcher);
  const { data: trendData, isLoading: trendLoading } = useSWR<TrendResponse>(
    `/citations/history?days=${trendDays}`,
    fetcher,
  );
  const { data: submissionsData } = useSWR<SubmissionsResponse>('/citations/submissions', fetcher);
  const { data: locData } = useSWR<LocationsResponse>('/locations', fetcher);

  const summary = data?.data;
  const directories = summary?.directories ?? [];
  const trendSeries = trendData?.data?.history ?? [];
  const submissions = submissionsData?.data?.submissions ?? [];
  const locations = locData?.data ?? [];

  const napErrorCount = directories.filter(hasNapError).length;

  const filteredDirs = sortDirectories(
    showErrorsOnly
      ? directories.filter((dir) => {
          if (!dir.listed) return true;
          if (!dir.napDetail) return false;
          return hasNapError(dir);
        })
      : directories,
  );

  return (
    <div className="space-y-6">
      {showBuilder && (
        <CitationBuilderModal
          locations={locations}
          onClose={() => setShowBuilder(false)}
          onDone={() => setActiveTab('submissions')}
        />
      )}

      <div>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Citations</h1>
          </div>
          <div className="flex gap-2">
            {isAdmin && (
              <button onClick={() => setShowBuilder(true)}
                className="whitespace-nowrap px-1.5 py-1 text-xs sm:px-4 sm:py-2 sm:text-sm font-medium bg-brand-600 text-white rounded-lg hover:bg-brand-700 transition-colors">
                Build Citations
              </button>
            )}
            <button
              onClick={() => setShowErrorsOnly((v) => !v)}
              className={`whitespace-nowrap px-1.5 py-1 text-xs sm:px-4 sm:py-2 sm:text-sm font-medium rounded-lg border transition-colors ${
                showErrorsOnly ? 'bg-brand-500 text-white border-brand-500' : 'text-slate-600 border-slate-200 hover:bg-slate-50'
              }`}
            >
              Show errors only
            </button>
          </div>
        </div>
        <p className="text-sm text-gray-500 mt-1">Business listing status across online directories</p>
        {napErrorCount > 0 && (
          <p className="text-sm text-red-600 font-medium mt-1">
            {napErrorCount} citation{napErrorCount !== 1 ? 's' : ''} have NAP errors
          </p>
        )}
      </div>

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          Failed to load citation data. Please refresh.
        </div>
      )}

      {/* Tab bar */}
      <div className="flex gap-1 border-b border-gray-200">
        <button onClick={() => setActiveTab('directories')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === 'directories' ? 'border-brand-500 text-brand-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
          Directories
        </button>
        <button onClick={() => setActiveTab('submissions')}
          className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === 'submissions' ? 'border-brand-500 text-brand-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
          Submissions
          {submissions.length > 0 && <span className="text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full">{submissions.length}</span>}
        </button>
      </div>

      {activeTab === 'submissions' ? (
        submissions.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-12 text-center">
            <p className="text-gray-400 text-sm mb-4">No submissions yet.</p>
            {isAdmin && (
              <button onClick={() => setShowBuilder(true)}
                className="px-4 py-2 text-sm font-medium bg-brand-600 text-white rounded-lg hover:bg-brand-700">
                Build Citations
              </button>
            )}
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Directory</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Submitted</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Live</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {submissions.map((s) => (
                  <tr key={s.id}>
                    <td className="px-6 py-3 font-medium text-gray-900">
                      {s.directory}
                      {s.listingUrl && <a href={s.listingUrl} target="_blank" rel="noopener noreferrer" className="ml-2 text-xs text-blue-500 hover:underline">↗</a>}
                    </td>
                    <td className="px-6 py-3">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_COLORS[s.status] ?? 'bg-gray-100 text-gray-600'}`}>
                        {s.status}
                      </span>
                      {s.rejectionReason && <span className="ml-2 text-xs text-red-500">{s.rejectionReason}</span>}
                    </td>
                    <td className="px-6 py-3 text-gray-500 text-xs">{new Date(s.submittedAt).toLocaleDateString()}</td>
                    <td className="px-6 py-3 text-gray-500 text-xs">{s.liveAt ? new Date(s.liveAt).toLocaleDateString() : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : (<>

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
      <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-5">
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
            No citation history yet.
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
                    <h3 className="font-semibold text-gray-900 text-sm">{directoryDisplayName(dir.name)}</h3>
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
      </>)}
    </div>
  );
}
