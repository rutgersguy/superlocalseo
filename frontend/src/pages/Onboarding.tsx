import { useState, useEffect, useRef, ChangeEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { mutate } from 'swr';
import { apiFetch } from '../services/api';

// ─── Field Tooltip ────────────────────────────────────────────────────────────

function FieldTooltip({ content }: { content: string }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-flex items-center ml-1 align-middle">
      <button
        type="button"
        aria-label="More info"
        className="w-4 h-4 rounded-full bg-gray-200 text-gray-500 hover:bg-gray-300 text-xs flex items-center justify-center focus:outline-none focus:ring-1 focus:ring-brand-400 leading-none"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={() => setOpen((v) => !v)}
      >
        ?
      </button>
      {open && (
        <span className="absolute left-5 top-0 z-20 w-60 rounded-lg bg-gray-900 px-3 py-2 text-xs text-white shadow-xl leading-relaxed pointer-events-none">
          <span className="absolute -left-1 top-2 w-2 h-2 bg-gray-900 rotate-45" />
          {content}
        </span>
      )}
    </span>
  );
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface Location {
  id?: string; // set after successful POST /locations
  name: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  phone: string;
  serviceArea: string[];
}

interface CitySuggestion { city: string; state: string | null; label: string; }

interface SavedKeyword {
  id: string;   // real DB id from POST /keywords
  keyword: string;
}

interface LocationKeywords {
  [locationIndex: number]: SavedKeyword[];
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

const INDUSTRY_GROUPS: Array<{ group: string; options: string[] }> = [
  { group: 'Home Services', options: ['Plumbing', 'HVAC', 'Electrical', 'Roofing', 'Landscaping', 'Cleaning', 'Pest Control', 'Painting', 'Flooring', 'Moving', 'General Contractor'] },
  { group: 'Health & Fitness', options: ['Personal Training', 'Gym / Fitness Studio', 'Physical Therapy', 'Chiropractic', 'Massage Therapy', 'Dental'] },
  { group: 'Legal', options: ['Law Firm', 'Family Law', 'Personal Injury'] },
  { group: 'Food & Beverage', options: ['Restaurant', 'Coffee Shop', 'Food Truck', 'Bakery'] },
  { group: 'Beauty & Personal Care', options: ['Hair Salon', 'Barbershop', 'Nail Salon', 'Med Spa'] },
  { group: 'Automotive', options: ['Auto Repair', 'Auto Detailing'] },
  { group: 'Professional Services', options: ['Accounting / CPA', 'Real Estate', 'Insurance', 'Veterinary', 'Photography', 'Tutoring'] },
  { group: 'Other', options: ['Other'] },
];

export default function Onboarding() {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const TOTAL_STEPS = 4;

  // Step 1 state
  const [businessName, setBusinessName] = useState('');
  const [industry, setIndustry] = useState('');

  // Step 2 state — locations are saved to DB immediately when added
  const [locations, setLocations] = useState<Location[]>([]);
  const [showAddLocation, setShowAddLocation] = useState(false);
  const [newLocation, setNewLocation] = useState<Location>({
    name: '', address: '', city: '', state: '', zip: '', phone: '', serviceArea: [],
  });
  // Service area city autocomplete state
  const [cityInput, setCityInput] = useState('');
  const [citySuggestions, setCitySuggestions] = useState<CitySuggestion[]>([]);
  const [citySuggestionsOpen, setCitySuggestionsOpen] = useState(false);
  const [loadingCitySuggestions, setLoadingCitySuggestions] = useState(false);
  const cityDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cityWrapperRef = useRef<HTMLDivElement>(null);
  const [locationSaving, setLocationSaving] = useState(false);
  const [locationError, setLocationError] = useState('');

  // Step 3 state — keywords are saved to DB immediately when added
  const [keywords, setKeywords] = useState<LocationKeywords>({});
  const [kwInput, setKwInput] = useState<{ [idx: number]: string }>({});
  const [kwSaving, setKwSaving] = useState<{ [idx: number]: boolean }>({});
  const [kwError, setKwError] = useState<{ [idx: number]: string }>({});

  // Step 4 state
  const [googleConnecting, setGoogleConnecting] = useState(false);
  const [provisioning, setProvisioning] = useState(false);
  const [gbpInfoOpen, setGbpInfoOpen] = useState(false);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // ── Load existing data on mount (handles resume) ────────────────────────────

  useEffect(() => {
    apiFetch<{ success: boolean; data: { businessName: string; industry: string | null; onboardingStep: number } }>('/clients')
      .then((res) => {
        if (res.data.businessName) setBusinessName(res.data.businessName);
        if (res.data.industry) setIndustry(res.data.industry);
        const saved = res.data.onboardingStep;
        if (saved > 0 && saved <= TOTAL_STEPS) setStep(saved);
      })
      .catch(() => {/* non-fatal */});

    // Load any locations already saved (for resume and deduplication)
    apiFetch<{ success: boolean; data: Array<{ id: string; name: string; address: string | null; city: string | null; state: string | null; zip: string | null; phone: string | null; serviceArea?: string[] }> }>('/locations')
      .then((res) => {
        if (!res.success || !res.data?.length) return;
        setLocations(res.data.map((l) => ({
          id: l.id,
          name: l.name,
          address: l.address ?? '',
          city: l.city ?? '',
          state: l.state ?? '',
          zip: l.zip ?? '',
          phone: l.phone ?? '',
          serviceArea: l.serviceArea ?? [],
        })));

        // Load keywords for each location
        res.data.forEach((loc, idx) => {
          apiFetch<{ success: boolean; data: Array<{ id: string; keyword: string }> }>(`/keywords?locationId=${loc.id}`)
            .then((kwRes) => {
              if (!kwRes.success || !kwRes.data?.length) return;
              setKeywords((prev) => ({
                ...prev,
                [idx]: kwRes.data.map((k) => ({ id: k.id, keyword: k.keyword })),
              }));
            })
            .catch(() => {/* non-fatal */});
        });
      })
      .catch(() => {/* non-fatal */});
  }, []);

  // ── Navigation helpers ──────────────────────────────────────────────────────

  const saveStep = async (nextStep: number) => {
    setSaving(true);
    setError('');
    try {
      const payload: Record<string, unknown> = { onboardingStep: nextStep };
      if (step === 1) {
        payload.businessName = businessName;
        payload.industry = industry || undefined;
      }
      await apiFetch('/clients', { method: 'PATCH', body: JSON.stringify(payload) });
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
    } catch {
      // Non-fatal: onboarding step was saved server-side even if provisioning timed out.
    } finally {
      setSaving(false);
      setProvisioning(false);
    }
    // Flush SWR cache before navigating so OnboardingRedirect sees the updated onboardingStep
    // and doesn't loop us back here.
    await mutate('/clients');
    navigate('/dashboard');
  };

  const handleSkip = async () => {
    try {
      const payload: Record<string, unknown> = { onboardingStep: step };
      if (step === 1) {
        if (businessName) payload.businessName = businessName;
        if (industry) payload.industry = industry;
      }
      await apiFetch('/clients', { method: 'PATCH', body: JSON.stringify(payload) });
    } catch { /* non-fatal */ }
    await mutate('/clients');
    navigate('/dashboard');
  };

  // ── Step 2 helpers — save to DB immediately ─────────────────────────────────

  // Close city suggestions dropdown on outside click
  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (cityWrapperRef.current && !cityWrapperRef.current.contains(e.target as Node)) {
        setCitySuggestionsOpen(false);
      }
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  function onCityInputChange(e: ChangeEvent<HTMLInputElement>) {
    const val = e.target.value;
    setCityInput(val);
    if (cityDebounceRef.current) clearTimeout(cityDebounceRef.current);
    if (val.trim().length < 2) { setCitySuggestions([]); setCitySuggestionsOpen(false); return; }
    cityDebounceRef.current = setTimeout(async () => {
      setLoadingCitySuggestions(true);
      try {
        const res = await apiFetch<{ success: boolean; data: CitySuggestion[] }>(`/places/cities?q=${encodeURIComponent(val.trim())}`);
        if (res.success && res.data.length > 0) {
          setCitySuggestions(res.data);
          setCitySuggestionsOpen(true);
        } else {
          setCitySuggestions([]);
          setCitySuggestionsOpen(false);
        }
      } catch { /* ignore */ } finally {
        setLoadingCitySuggestions(false);
      }
    }, 300);
  }

  function selectCitySuggestion(s: CitySuggestion) {
    const label = s.label;
    if (!newLocation.serviceArea.includes(label)) {
      setNewLocation((p) => ({ ...p, serviceArea: [...p.serviceArea, label] }));
    }
    setCityInput('');
    setCitySuggestions([]);
    setCitySuggestionsOpen(false);
  }

  function addCityManual() {
    const trimmed = cityInput.trim();
    if (!trimmed || newLocation.serviceArea.includes(trimmed)) { setCityInput(''); return; }
    setNewLocation((p) => ({ ...p, serviceArea: [...p.serviceArea, trimmed] }));
    setCityInput('');
    setCitySuggestions([]);
    setCitySuggestionsOpen(false);
  }

  function removeServiceCity(city: string) {
    setNewLocation((p) => ({ ...p, serviceArea: p.serviceArea.filter((c) => c !== city) }));
  }

  const addLocation = async () => {
    if (!newLocation.name || !newLocation.address) return;
    setLocationSaving(true);
    setLocationError('');
    try {
      const res = await apiFetch<{ success: boolean; data: { id: string }; error?: { message: string } }>(
        '/locations',
        { method: 'POST', body: JSON.stringify(newLocation) },
      );
      if (!res.success) {
        setLocationError(res.error?.message ?? 'Failed to save location');
        return;
      }
      setLocations((prev) => [...prev, { ...newLocation, id: res.data.id }]);
      setNewLocation({ name: '', address: '', city: '', state: '', zip: '', phone: '', serviceArea: [] });
      setCityInput('');
      setShowAddLocation(false);
    } catch {
      setLocationError('Network error — please try again');
    } finally {
      setLocationSaving(false);
    }
  };

  const removeLocation = async (idx: number) => {
    const loc = locations[idx];
    if (loc.id) {
      try {
        await apiFetch(`/locations/${loc.id}`, { method: 'DELETE' });
      } catch { /* non-fatal — remove from UI anyway */ }
    }
    setLocations((prev) => prev.filter((_, i) => i !== idx));
    // Clean up keywords for this index and re-index remaining
    setKeywords((prev) => {
      const next: LocationKeywords = {};
      Object.entries(prev).forEach(([k, v]) => {
        const ki = parseInt(k, 10);
        if (ki < idx) next[ki] = v;
        else if (ki > idx) next[ki - 1] = v;
        // ki === idx is dropped
      });
      return next;
    });
  };

  // ── Step 3 helpers — save to DB immediately ─────────────────────────────────

  const addKeyword = async (locIdx: number) => {
    const kw = (kwInput[locIdx] ?? '').trim();
    if (!kw) return;

    const loc = locations[locIdx];
    if (!loc?.id) {
      // Shouldn't happen if step 2 saved correctly, but fall back gracefully
      setKwError((prev) => ({ ...prev, [locIdx]: 'Location not saved yet — please go back and re-add it' }));
      return;
    }

    setKwSaving((prev) => ({ ...prev, [locIdx]: true }));
    setKwError((prev) => ({ ...prev, [locIdx]: '' }));
    try {
      const res = await apiFetch<{ success: boolean; data: { id: string; keyword: string }; error?: { message: string } }>(
        '/keywords',
        { method: 'POST', body: JSON.stringify({ locationId: loc.id, keyword: kw }) },
      );
      if (!res.success) {
        setKwError((prev) => ({ ...prev, [locIdx]: res.error?.message ?? 'Failed to save keyword' }));
        return;
      }
      setKeywords((prev) => ({
        ...prev,
        [locIdx]: [...(prev[locIdx] ?? []), { id: res.data.id, keyword: res.data.keyword }],
      }));
      setKwInput((prev) => ({ ...prev, [locIdx]: '' }));
    } catch {
      setKwError((prev) => ({ ...prev, [locIdx]: 'Network error — please try again' }));
    } finally {
      setKwSaving((prev) => ({ ...prev, [locIdx]: false }));
    }
  };

  const removeKeyword = async (locIdx: number, kwIdx: number) => {
    const kw = keywords[locIdx]?.[kwIdx];
    if (kw?.id) {
      try {
        await apiFetch(`/keywords/${kw.id}`, { method: 'DELETE' });
      } catch { /* non-fatal */ }
    }
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
        <div className="mb-8">
          <div className="flex items-center justify-between mb-3">
            <img src="/sls_logo_wide_color.png" alt="SuperLocalSEO" className="h-8 w-auto" />
            <button
              onClick={() => void handleSkip()}
              className="text-sm text-gray-400 hover:text-gray-600 hover:underline"
            >
              Finish later
            </button>
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Set up your account</h1>
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
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Business Name
                  <FieldTooltip content="Enter exactly as it appears on your Google Business Profile. Consistent name, address, and phone (NAP) across the web is a key local ranking factor." />
                </label>
                <input
                  type="text"
                  value={businessName}
                  onChange={(e) => setBusinessName(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                  placeholder="e.g. Sunrise Fitness, Metro Law Group"
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
                  {INDUSTRY_GROUPS.map(({ group, options }) => (
                    <optgroup key={group} label={group}>
                      {options.map((ind) => (
                        <option key={ind} value={ind}>{ind}</option>
                      ))}
                    </optgroup>
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
                <div key={loc.id ?? idx} className="flex items-start justify-between p-4 border border-gray-200 rounded-lg">
                  <div>
                    <p className="font-medium text-gray-900 text-sm">{loc.name}</p>
                    <p className="text-xs text-gray-500 mt-0.5">{loc.address}, {loc.city}, {loc.state} {loc.zip}</p>
                    {loc.phone && <p className="text-xs text-gray-500">{loc.phone}</p>}
                    {loc.serviceArea.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {loc.serviceArea.map((city) => (
                          <span key={city} className="text-xs bg-brand-50 text-brand-700 px-2 py-0.5 rounded-full border border-brand-200">{city}</span>
                        ))}
                      </div>
                    )}
                  </div>
                  <button
                    onClick={() => void removeLocation(idx)}
                    className="text-red-400 hover:text-red-600 text-xs ml-4"
                  >
                    Remove
                  </button>
                </div>
              ))}

              {locationError && (
                <p className="text-sm text-red-600">{locationError}</p>
              )}

              {showAddLocation ? (
                <div className="border border-brand-500 rounded-lg p-5 space-y-4">
                  <h3 className="text-sm font-semibold text-gray-900">Add Location</h3>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="col-span-2">
                      <label className="block text-xs text-gray-500 mb-1">Location name *</label>
                      <input type="text" value={newLocation.name}
                        onChange={(e) => setNewLocation((p) => ({ ...p, name: e.target.value }))}
                        placeholder="e.g. Main Office"
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
                    </div>
                    <div className="col-span-2">
                      <label className="block text-xs text-gray-500 mb-1">Address *</label>
                      <input type="text" value={newLocation.address}
                        onChange={(e) => setNewLocation((p) => ({ ...p, address: e.target.value }))}
                        placeholder="123 Main St"
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">City</label>
                      <input type="text" value={newLocation.city}
                        onChange={(e) => setNewLocation((p) => ({ ...p, city: e.target.value }))}
                        placeholder="Austin"
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">State</label>
                        <input type="text" value={newLocation.state}
                          onChange={(e) => setNewLocation((p) => ({ ...p, state: e.target.value }))}
                          placeholder="TX"
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">ZIP</label>
                        <input type="text" value={newLocation.zip}
                          onChange={(e) => setNewLocation((p) => ({ ...p, zip: e.target.value }))}
                          placeholder="78701"
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">
                        Phone
                        <FieldTooltip content="Use the exact format shown on your Google Business Profile. Inconsistent phone formats across the web hurt local rankings (this is called NAP consistency)." />
                      </label>
                      <input type="text" value={newLocation.phone}
                        onChange={(e) => setNewLocation((p) => ({ ...p, phone: e.target.value }))}
                        placeholder="+15125550100"
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
                    </div>
                    <div className="col-span-2">
                      <label className="block text-xs text-gray-500 mb-1">
                        Service area cities
                        <FieldTooltip content="Cities where you want to rank in search results. If you serve customers outside your main city, add those here — we'll track your rankings in each one." />
                        <span className="text-gray-400 ml-1">(optional)</span>
                      </label>
                      {newLocation.serviceArea.length > 0 && (
                        <div className="flex flex-wrap gap-1 mb-2">
                          {newLocation.serviceArea.map((city) => (
                            <span key={city} className="inline-flex items-center gap-1 bg-brand-50 text-brand-700 text-xs font-medium px-2 py-1 rounded-full border border-brand-200">
                              {city}
                              <button type="button" onClick={() => removeServiceCity(city)} className="hover:text-brand-900 leading-none">&times;</button>
                            </span>
                          ))}
                        </div>
                      )}
                      <div ref={cityWrapperRef} className="relative">
                        <div className="flex gap-2">
                          <input
                            value={cityInput}
                            onChange={onCityInputChange}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ',') {
                                e.preventDefault();
                                citySuggestionsOpen && citySuggestions[0] ? selectCitySuggestion(citySuggestions[0]) : addCityManual();
                              }
                              if (e.key === 'Escape') setCitySuggestionsOpen(false);
                            }}
                            placeholder="Search for a city…"
                            className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                            autoComplete="off"
                          />
                          {!citySuggestionsOpen && (
                            <button type="button" onClick={addCityManual}
                              className="px-3 py-2 bg-gray-100 text-gray-600 text-sm rounded-lg hover:bg-gray-200 transition-colors whitespace-nowrap">
                              {loadingCitySuggestions ? '…' : '+ Add'}
                            </button>
                          )}
                        </div>
                        {citySuggestionsOpen && citySuggestions.length > 0 && (
                          <ul className="absolute z-10 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                            {citySuggestions.map((s) => (
                              <li key={s.label}
                                onMouseDown={() => selectCitySuggestion(s)}
                                className="px-3 py-2 text-sm text-gray-700 hover:bg-brand-50 cursor-pointer">
                                {s.label}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                      <p className="text-xs text-gray-400 mt-1">Type a city name and press Enter or select from the list. Used for keyword rank tracking across your service area.</p>
                    </div>
                  </div>
                  <div className="flex gap-3">
                    <button
                      onClick={() => void addLocation()}
                      disabled={locationSaving || !newLocation.name || !newLocation.address}
                      className="bg-brand-500 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-brand-600 disabled:opacity-50 flex items-center gap-2"
                    >
                      {locationSaving && <span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                      {locationSaving ? 'Saving…' : 'Add location'}
                    </button>
                    <button
                      onClick={() => { setShowAddLocation(false); setLocationError(''); setCityInput(''); }}
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
                  <div key={loc.id ?? locIdx}>
                    <p className="text-sm font-semibold text-gray-800 mb-2">{loc.name}</p>
                    <div className="flex gap-2 mb-1">
                      <input
                        type="text"
                        value={kwInput[locIdx] ?? ''}
                        onChange={(e) => setKwInput((p) => ({ ...p, [locIdx]: e.target.value }))}
                        onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), void addKeyword(locIdx))}
                        className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                        placeholder="e.g. personal trainer in Brooklyn"
                        disabled={kwSaving[locIdx]}
                      />
                      <button
                        onClick={() => void addKeyword(locIdx)}
                        disabled={kwSaving[locIdx] || !kwInput[locIdx]?.trim()}
                        className="bg-brand-500 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-brand-600 disabled:opacity-50 flex items-center gap-2"
                      >
                        {kwSaving[locIdx] && <span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                        Add
                      </button>
                    </div>
                    {kwError[locIdx] && (
                      <p className="mb-2 text-xs text-red-600">{kwError[locIdx]}</p>
                    )}
                    <div className="flex flex-wrap gap-2 mt-2">
                      {(keywords[locIdx] ?? []).map((kw, kwIdx) => (
                        <span
                          key={kw.id}
                          className="flex items-center gap-1.5 bg-brand-50 text-brand-500 text-xs font-medium px-3 py-1.5 rounded-full"
                        >
                          {kw.keyword}
                          <button
                            onClick={() => void removeKeyword(locIdx, kwIdx)}
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

              {/* Citation scan notice */}
              <div className="bg-brand-50 border border-brand-100 rounded-xl p-4 flex gap-3">
                <div className="flex-shrink-0 mt-0.5">
                  <svg className="w-5 h-5 text-brand-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <div>
                  <p className="text-sm font-medium text-brand-800">Citation scan starting automatically</p>
                  <p className="text-xs text-brand-600 mt-0.5">We'll scan your business across Google, Yelp, Facebook, Bing, Apple Maps, BBB, and more — results will appear in your Citations page within a few minutes.</p>
                </div>
              </div>

              {/* Google Business Profile */}
              <div className="border border-gray-200 rounded-xl p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-semibold text-gray-900">
                      Google Business Profile
                      <FieldTooltip content="Connecting your Google Business Profile lets us pull your reviews directly and improves Google's confidence in your listing data. You can connect it later in Settings → Integrations." />
                    </h3>
                    <p className="text-xs text-gray-500 mt-0.5">Sync reviews, Q&A, and business info from Google</p>
                  </div>
                </div>
                <button
                  onClick={() => void connectGoogle()}
                  disabled={googleConnecting}
                  className="bg-brand-500 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-brand-600 disabled:opacity-50"
                >
                  {googleConnecting ? 'Redirecting...' : 'Connect Google'}
                </button>

                {/* No GBP yet? collapsible */}
                <div className="border-t border-gray-100 pt-3">
                  <button
                    type="button"
                    onClick={() => setGbpInfoOpen((v) => !v)}
                    className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-700 transition-colors"
                  >
                    <svg
                      className={`w-3.5 h-3.5 transition-transform ${gbpInfoOpen ? 'rotate-90' : ''}`}
                      fill="none" stroke="currentColor" viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                    Don't have a Google Business Profile yet?
                  </button>
                  {gbpInfoOpen && (
                    <div className="mt-3 rounded-lg bg-gray-50 border border-gray-200 p-4 space-y-3 text-xs text-gray-600">
                      <p>
                        A free Google Business Profile puts your business on Google Maps and local search results.
                        It takes about 5 minutes to create — Google will then send a verification postcard to your
                        business address (typically 5–14 days).
                      </p>
                      <ol className="list-decimal list-inside space-y-1 text-gray-500">
                        <li>Create your profile at the link below</li>
                        <li>Enter your business name, address, and category</li>
                        <li>Wait for Google's verification postcard</li>
                        <li>Come back to <strong className="text-gray-700">Settings → Integrations</strong> to connect it here</li>
                      </ol>
                      <a
                        href="https://business.google.com/create"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 font-medium text-brand-600 hover:text-brand-700 hover:underline"
                      >
                        Create your free Google Business Profile →
                      </a>
                    </div>
                  )}
                </div>
              </div>


              {/* Facebook */}
              <div className="border border-gray-200 rounded-xl p-5">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h3 className="text-sm font-semibold text-gray-900">Facebook</h3>
                    <p className="text-xs text-gray-500">Sync Facebook page ratings and reviews</p>
                  </div>
                </div>
                <a
                  href="/dashboard/settings?tab=integrations"
                  className="inline-block bg-[#1877F2] text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-[#1565d8] transition-colors"
                >
                  Connect Facebook in Settings →
                </a>
                <p className="text-xs text-gray-400 mt-2">Optional — you can connect Facebook any time from Settings.</p>
              </div>

              <p className="text-xs text-gray-400">You can also connect or change platforms any time in Settings.</p>
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
