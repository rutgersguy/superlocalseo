import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../services/api';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Location {
  id?: string;
  name: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  phone: string;
}

interface LocationKeywords {
  [locationIndex: number]: string[];
}

// ─── Step indicator ───────────────────────────────────────────────────────────

function StepIndicator({ current, total }: { current: number; total: number }) {
  return (
    <div className="flex items-center gap-2 mb-8">
      {Array.from({ length: total }, (_, i) => (
        <div key={i} className="flex items-center gap-2">
          <div
            className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold transition-colors ${
              i + 1 < current
                ? 'bg-brand-500 text-white'
                : i + 1 === current
                ? 'bg-brand-500 text-white ring-4 ring-brand-50'
                : 'bg-gray-200 text-gray-500'
            }`}
          >
            {i + 1 < current ? (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            ) : (
              i + 1
            )}
          </div>
          {i < total - 1 && (
            <div className={`h-0.5 w-12 ${i + 1 < current ? 'bg-brand-500' : 'bg-gray-200'}`} />
          )}
        </div>
      ))}
      <span className="ml-3 text-sm text-gray-500">Step {current} of {total}</span>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

const INDUSTRIES = ['Plumbing', 'HVAC', 'Electrical', 'Landscaping', 'Cleaning', 'Other'];

export default function Onboarding() {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const TOTAL_STEPS = 4;

  // Step 1 state
  const [businessName, setBusinessName] = useState('');
  const [industry, setIndustry] = useState('');

  // Step 2 state
  const [locations, setLocations] = useState<Location[]>([]);
  const [showAddLocation, setShowAddLocation] = useState(false);
  const [newLocation, setNewLocation] = useState<Location>({
    name: '', address: '', city: '', state: '', zip: '', phone: '',
  });

  // Step 3 state
  const [keywords, setKeywords] = useState<LocationKeywords>({});
  const [kwInput, setKwInput] = useState<{ [idx: number]: string }>({});

  // Step 4 state
  const [googleConnecting, setGoogleConnecting] = useState(false);
  const [provisioning, setProvisioning] = useState(false);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // ── Navigation helpers ──────────────────────────────────────────────────────

  const saveStep = async (nextStep: number) => {
    setSaving(true);
    setError('');
    try {
      await apiFetch('/clients', {
        method: 'PATCH',
        body: JSON.stringify({ onboardingStep: nextStep }),
      });
      setStep(nextStep);
    } catch {
      setError('Failed to save progress. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleNext = () => {
    if (step < TOTAL_STEPS) void saveStep(step + 1);
  };

  const handleBack = () => {
    if (step > 1) setStep(step - 1);
  };

  const handleFinish = async () => {
    setSaving(true);
    setProvisioning(true);
    setError('');
    try {
      await apiFetch('/clients/complete-onboarding', { method: 'POST' });
      navigate('/dashboard/settings?tab=billing');
    } catch {
      // Non-fatal: onboarding step was saved server-side even if provisioning timed out.
      navigate('/dashboard/settings?tab=billing');
    } finally {
      setSaving(false);
      setProvisioning(false);
    }
  };

  // ── Step 2 helpers ──────────────────────────────────────────────────────────

  const addLocation = () => {
    if (!newLocation.name || !newLocation.address) return;
    setLocations((prev) => [...prev, { ...newLocation }]);
    setNewLocation({ name: '', address: '', city: '', state: '', zip: '', phone: '' });
    setShowAddLocation(false);
  };

  const removeLocation = (idx: number) => {
    setLocations((prev) => prev.filter((_, i) => i !== idx));
  };

  // ── Step 3 helpers ──────────────────────────────────────────────────────────

  const addKeyword = (locIdx: number) => {
    const kw = (kwInput[locIdx] ?? '').trim();
    if (!kw) return;
    setKeywords((prev) => ({
      ...prev,
      [locIdx]: [...(prev[locIdx] ?? []), kw],
    }));
    setKwInput((prev) => ({ ...prev, [locIdx]: '' }));
  };

  const removeKeyword = (locIdx: number, kwIdx: number) => {
    setKeywords((prev) => ({
      ...prev,
      [locIdx]: (prev[locIdx] ?? []).filter((_, i) => i !== kwIdx),
    }));
  };

  // ── Step 4 helpers ──────────────────────────────────────────────────────────

  const connectGoogle = async () => {
    setGoogleConnecting(true);
    try {
      const res = await apiFetch<{ success: boolean; data: { url: string } }>('/integrations/google/auth-url');
      if (res.success && res.data?.url) window.location.href = res.data.url;
    } finally {
      setGoogleConnecting(false);
    }
  };

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4">
      <div className="max-w-2xl mx-auto">
        <div className="text-center mb-8">
          <span className="text-2xl font-bold text-brand-500">SuperLocalSEO</span>
          <h1 className="mt-3 text-2xl font-bold text-gray-900">Set up your account</h1>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8">
          <StepIndicator current={step} total={TOTAL_STEPS} />

          {error && (
            <div className="mb-6 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>
          )}

          {/* Step 1 — Business Info */}
          {step === 1 && (
            <div className="space-y-5">
              <h2 className="text-lg font-semibold text-gray-900">Business Information</h2>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Business Name</label>
                <input
                  type="text"
                  value={businessName}
                  onChange={(e) => setBusinessName(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                  placeholder="Acme Plumbing"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Industry</label>
                <select
                  value={industry}
                  onChange={(e) => setIndustry(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                >
                  <option value="">Select an industry</option>
                  {INDUSTRIES.map((ind) => (
                    <option key={ind} value={ind}>{ind}</option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {/* Step 2 — Locations */}
          {step === 2 && (
            <div className="space-y-5">
              <h2 className="text-lg font-semibold text-gray-900">Your Locations</h2>
              {locations.length === 0 && !showAddLocation && (
                <p className="text-sm text-gray-500">No locations added yet. Add your first location below.</p>
              )}
              {locations.map((loc, idx) => (
                <div key={idx} className="flex items-start justify-between p-4 border border-gray-200 rounded-lg">
                  <div>
                    <p className="font-medium text-gray-900 text-sm">{loc.name}</p>
                    <p className="text-xs text-gray-500 mt-0.5">{loc.address}, {loc.city}, {loc.state} {loc.zip}</p>
                    {loc.phone && <p className="text-xs text-gray-500">{loc.phone}</p>}
                  </div>
                  <button
                    onClick={() => removeLocation(idx)}
                    className="text-red-400 hover:text-red-600 text-xs ml-4"
                  >
                    Remove
                  </button>
                </div>
              ))}

              {showAddLocation ? (
                <div className="border border-brand-500 rounded-lg p-5 space-y-4">
                  <h3 className="text-sm font-semibold text-gray-900">Add Location</h3>
                  {(['name', 'address', 'city', 'state', 'zip', 'phone'] as const).map((field) => (
                    <div key={field}>
                      <label className="block text-sm font-medium text-gray-700 mb-1 capitalize">{field}</label>
                      <input
                        type="text"
                        value={newLocation[field]}
                        onChange={(e) => setNewLocation((p) => ({ ...p, [field]: e.target.value }))}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                      />
                    </div>
                  ))}
                  <div className="flex gap-3">
                    <button
                      onClick={addLocation}
                      className="bg-brand-500 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-brand-600"
                    >
                      Add
                    </button>
                    <button
                      onClick={() => setShowAddLocation(false)}
                      className="text-gray-600 px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-100"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setShowAddLocation(true)}
                  className="flex items-center gap-2 text-sm text-brand-500 font-medium hover:underline"
                >
                  + Add location
                </button>
              )}
            </div>
          )}

          {/* Step 3 — Keywords */}
          {step === 3 && (
            <div className="space-y-6">
              <h2 className="text-lg font-semibold text-gray-900">Target Keywords</h2>
              {locations.length === 0 ? (
                <p className="text-sm text-gray-500">No locations added. Go back to add a location first.</p>
              ) : (
                locations.map((loc, locIdx) => (
                  <div key={locIdx}>
                    <p className="text-sm font-semibold text-gray-800 mb-2">{loc.name}</p>
                    <div className="flex gap-2 mb-3">
                      <input
                        type="text"
                        value={kwInput[locIdx] ?? ''}
                        onChange={(e) => setKwInput((p) => ({ ...p, [locIdx]: e.target.value }))}
                        onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addKeyword(locIdx))}
                        className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                        placeholder="e.g. plumber near me"
                      />
                      <button
                        onClick={() => addKeyword(locIdx)}
                        className="bg-brand-500 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-brand-600"
                      >
                        Add
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {(keywords[locIdx] ?? []).map((kw, kwIdx) => (
                        <span
                          key={kwIdx}
                          className="flex items-center gap-1.5 bg-brand-50 text-brand-500 text-xs font-medium px-3 py-1.5 rounded-full"
                        >
                          {kw}
                          <button
                            onClick={() => removeKeyword(locIdx, kwIdx)}
                            className="hover:text-brand-700 font-bold leading-none"
                          >
                            ×
                          </button>
                        </span>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {/* Step 4 — Integrations */}
          {step === 4 && (
            <div className="space-y-6">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Connect your platforms</h2>
                <p className="text-sm text-gray-500 mt-1">Link your review profiles so we can monitor and manage them for you.</p>
              </div>

              {/* Google Business Profile */}
              <div className="border border-gray-200 rounded-xl p-5">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h3 className="text-sm font-semibold text-gray-900">Google Business Profile</h3>
                    <p className="text-xs text-gray-500">Sync reviews, Q&A, and business info from Google</p>
                  </div>
                </div>
                <button
                    onClick={() => void connectGoogle()}
                    disabled={googleConnecting}
                    className="bg-brand-500 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-brand-600 disabled:opacity-50"
                  >
                    {googleConnecting ? 'Redirecting...' : 'Connect Google'}
                  </button>
              </div>

              {/* Yelp */}
              <div className="border border-gray-200 rounded-xl p-5 opacity-60">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-semibold text-gray-900">Yelp</h3>
                    <p className="text-xs text-gray-500">Monitor and respond to Yelp reviews</p>
                  </div>
                  <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-400">Coming soon</span>
                </div>
              </div>

              {/* Facebook */}
              <div className="border border-gray-200 rounded-xl p-5 opacity-60">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-semibold text-gray-900">Facebook</h3>
                    <p className="text-xs text-gray-500">Sync Facebook reviews and business updates</p>
                  </div>
                  <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-400">Coming soon</span>
                </div>
              </div>

              <p className="text-xs text-gray-400">You can also connect platforms later in Settings.</p>
            </div>
          )}

          {/* Navigation buttons */}
          <div className="flex items-center justify-between mt-8 pt-6 border-t border-gray-100">
            <button
              onClick={handleBack}
              disabled={step === 1}
              className="px-5 py-2.5 text-sm font-medium text-gray-600 hover:text-gray-900 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Back
            </button>
            {step < TOTAL_STEPS ? (
              <button
                onClick={handleNext}
                disabled={saving}
                className="bg-brand-500 text-white px-6 py-2.5 rounded-lg text-sm font-semibold hover:bg-brand-600 disabled:opacity-50"
              >
                {saving ? 'Saving...' : 'Next'}
              </button>
            ) : (
              <button
                onClick={() => void handleFinish()}
                disabled={saving}
                className="bg-brand-500 text-white px-6 py-2.5 rounded-lg text-sm font-semibold hover:bg-brand-600 disabled:opacity-50"
              >
                {provisioning ? 'Setting up your review account…' : saving ? 'Finishing…' : 'Finish'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
