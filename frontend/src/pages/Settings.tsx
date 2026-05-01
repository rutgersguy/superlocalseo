import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import useSWR from 'swr';
import { apiFetch, fetcher } from '../services/api';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ClientData {
  email: string;
  businessName: string;
  industry: string;
  integrations: {
    google: { connected: boolean };
  };
  billing: {
    plan: string;
    status: string;
  };
}

interface ClientResponse {
  success: boolean;
  data: ClientData;
}

const INDUSTRIES = ['Plumbing', 'HVAC', 'Electrical', 'Landscaping', 'Cleaning', 'Other'];
type Tab = 'account' | 'integrations' | 'billing';

// ─── Tabs ─────────────────────────────────────────────────────────────────────

function TabBar({ active, onChange }: { active: Tab; onChange: (t: Tab) => void }) {
  const tabs: { key: Tab; label: string }[] = [
    { key: 'account', label: 'Account' },
    { key: 'integrations', label: 'Integrations' },
    { key: 'billing', label: 'Billing' },
  ];
  return (
    <div className="flex gap-1 border-b border-gray-200 mb-6">
      {tabs.map((t) => (
        <button
          key={t.key}
          onClick={() => onChange(t.key)}
          className={`px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px ${
            active === t.key
              ? 'border-brand-500 text-brand-500'
              : 'border-transparent text-gray-500 hover:text-gray-900'
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

// ─── OAuth card ────────────────────────────────────────────────────────────────

interface OAuthCardProps {
  name: string;
  description: string;
  connected: boolean;
  comingSoon?: boolean;
  onConnect: () => Promise<void>;
  onDisconnect: () => Promise<void>;
}

function OAuthCard({ name, description, connected, comingSoon, onConnect, onDisconnect }: OAuthCardProps) {
  const [loading, setLoading] = useState(false);

  const handleConnect = async () => {
    setLoading(true);
    try { await onConnect(); } finally { setLoading(false); }
  };

  const handleDisconnect = async () => {
    setLoading(true);
    try { await onDisconnect(); } finally { setLoading(false); }
  };

  return (
    <div className="border border-gray-200 rounded-xl p-5">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">{name}</h3>
          <p className="text-xs text-gray-500 mt-0.5">{description}</p>
        </div>
        {comingSoon ? (
          <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-400">Coming soon</span>
        ) : (
          <span
            className={`text-xs font-medium px-2 py-0.5 rounded-full ${
              connected ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
            }`}
          >
            {connected ? 'Connected' : 'Not connected'}
          </span>
        )}
      </div>
      {!comingSoon && (
        <div className="mt-4">
          {connected ? (
            <button
              onClick={() => void handleDisconnect()}
              disabled={loading}
              className="px-4 py-2 text-sm font-medium text-red-600 border border-red-200 rounded-lg hover:bg-red-50 disabled:opacity-50"
            >
              {loading ? 'Disconnecting...' : 'Disconnect'}
            </button>
          ) : (
            <button
              onClick={() => void handleConnect()}
              disabled={loading}
              className="px-4 py-2 text-sm font-medium bg-brand-500 text-white rounded-lg hover:bg-brand-600 disabled:opacity-50"
            >
              {loading ? 'Redirecting...' : `Connect ${name}`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function Settings() {
  const [searchParams] = useSearchParams();
  const defaultTab = (searchParams.get('tab') as Tab | null) ?? 'account';
  const [activeTab, setActiveTab] = useState<Tab>(defaultTab);
  const { data, isLoading, error, mutate } = useSWR<ClientResponse>('/clients', fetcher);
  const client = data?.data;

  // Account form state
  const [businessName, setBusinessName] = useState('');
  const [industry, setIndustry] = useState('');
  const [accountSaving, setAccountSaving] = useState(false);
  const [accountSuccess, setAccountSuccess] = useState(false);

  const resolvedBusinessName = businessName || client?.businessName || '';
  const resolvedIndustry = industry || client?.industry || '';

  const saveAccount = async () => {
    setAccountSaving(true);
    setAccountSuccess(false);
    try {
      await apiFetch('/clients', {
        method: 'PATCH',
        body: JSON.stringify({ businessName: resolvedBusinessName, industry: resolvedIndustry }),
      });
      await mutate();
      setAccountSuccess(true);
      setTimeout(() => setAccountSuccess(false), 3000);
    } finally {
      setAccountSaving(false);
    }
  };

  const connectGoogle = async () => {
    const res = await apiFetch<{ success: boolean; data: { url: string } }>('/integrations/google/auth-url');
    if (res.success && res.data?.url) window.location.href = res.data.url;
  };

  const disconnectGoogle = async () => {
    await apiFetch('/integrations/google', { method: 'DELETE' });
    await mutate();
  };

  const openBillingPortal = async () => {
    const res = await apiFetch<{ success: boolean; data: { url: string } }>('/billing/portal', {
      method: 'POST',
    });
    if (res.success && res.data?.url) window.location.href = res.data.url;
  };

  if (error) {
    return (
      <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
        Failed to load settings. Please refresh.
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
        <p className="text-sm text-gray-500 mt-1">Manage your account, integrations, and billing</p>
      </div>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
        <TabBar active={activeTab} onChange={setActiveTab} />

        {/* Account tab */}
        {activeTab === 'account' && (
          <div className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
              <input
                type="email"
                value={client?.email ?? ''}
                readOnly
                className="w-full border border-gray-200 bg-gray-50 rounded-lg px-3 py-2 text-sm text-gray-500 cursor-not-allowed"
              />
              <p className="mt-1 text-xs text-gray-400">Email cannot be changed here.</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Business Name</label>
              {isLoading ? (
                <div className="h-9 bg-gray-200 rounded-lg animate-pulse" />
              ) : (
                <input
                  type="text"
                  value={resolvedBusinessName}
                  onChange={(e) => setBusinessName(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Industry</label>
              {isLoading ? (
                <div className="h-9 bg-gray-200 rounded-lg animate-pulse" />
              ) : (
                <select
                  value={resolvedIndustry}
                  onChange={(e) => setIndustry(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                >
                  <option value="">Select industry</option>
                  {INDUSTRIES.map((ind) => <option key={ind} value={ind}>{ind}</option>)}
                </select>
              )}
            </div>
            <div className="flex items-center gap-3 pt-2">
              <button
                onClick={() => void saveAccount()}
                disabled={accountSaving || isLoading}
                className="bg-brand-500 text-white px-5 py-2.5 rounded-lg text-sm font-semibold hover:bg-brand-600 disabled:opacity-50"
              >
                {accountSaving ? 'Saving...' : 'Save changes'}
              </button>
              {accountSuccess && (
                <span className="text-sm text-green-600 font-medium">Saved!</span>
              )}
            </div>
          </div>
        )}

        {/* Integrations tab */}
        {activeTab === 'integrations' && (
          <div className="space-y-4">
            <OAuthCard
              name="Google Business Profile"
              description="Sync reviews, Q&A, and business info from Google"
              connected={client?.integrations?.google?.connected ?? false}
              onConnect={connectGoogle}
              onDisconnect={disconnectGoogle}
            />
            <OAuthCard
              name="Yelp"
              description="Monitor and respond to Yelp reviews"
              connected={false}
              comingSoon
              onConnect={async () => {}}
              onDisconnect={async () => {}}
            />
            <OAuthCard
              name="Facebook"
              description="Sync Facebook reviews and business updates"
              connected={false}
              comingSoon
              onConnect={async () => {}}
              onDisconnect={async () => {}}
            />
          </div>
        )}

        {/* Billing tab */}
        {activeTab === 'billing' && (
          <div className="space-y-5">
            {isLoading ? (
              <div className="space-y-3 animate-pulse">
                <div className="h-5 bg-gray-200 rounded w-40" />
                <div className="h-4 bg-gray-200 rounded w-28" />
              </div>
            ) : (
              <div className="border border-gray-200 rounded-xl p-5">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-sm font-semibold text-gray-900">Current Plan</p>
                    <p className="text-2xl font-bold text-gray-900 mt-1 capitalize">
                      {client?.billing?.plan ?? 'Free'}
                    </p>
                  </div>
                  <span
                    className={`text-xs font-medium px-2.5 py-1 rounded-full capitalize ${
                      client?.billing?.status === 'active'
                        ? 'bg-green-100 text-green-700'
                        : 'bg-gray-100 text-gray-600'
                    }`}
                  >
                    {client?.billing?.status ?? 'inactive'}
                  </span>
                </div>
              </div>
            )}
            <button
              onClick={() => void openBillingPortal()}
              className="bg-brand-500 text-white px-5 py-2.5 rounded-lg text-sm font-semibold hover:bg-brand-600"
            >
              Manage billing
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
