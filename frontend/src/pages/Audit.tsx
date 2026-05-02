import { useState } from 'react';
import { Link } from 'react-router-dom';
import { apiFetch } from '../services/api';

// ─── Types ────────────────────────────────────────────────────────────────────

interface CategoryScore {
  grade: string;
  score: number;
  label: string;
  details: string[];
  locked: boolean;
}

interface AuditData {
  businessName: string | null;
  formattedAddress: string | null;
  overallGrade: string;
  overallScore: number;
  categories: CategoryScore[];
}

interface ScanResponse {
  success: boolean;
  data: { scanId: string; audit: AuditData };
}

interface CaptureResponse {
  success: boolean;
  data: { audit: AuditData };
}

type Step = 'form' | 'scanning' | 'results' | 'unlocked';

// ─── Grade badge ──────────────────────────────────────────────────────────────

const GRADE_COLORS: Record<string, string> = {
  A: 'bg-green-100 text-green-700',
  B: 'bg-blue-100 text-blue-700',
  C: 'bg-yellow-100 text-yellow-700',
  D: 'bg-orange-100 text-orange-700',
  F: 'bg-red-100 text-red-700',
};

function GradeBadge({ grade }: { grade: string }) {
  return (
    <span className={`text-2xl font-bold px-3 py-1 rounded-lg ${GRADE_COLORS[grade] ?? 'bg-gray-100 text-gray-600'}`}>
      {grade}
    </span>
  );
}

// ─── Category card ────────────────────────────────────────────────────────────

function CategoryCard({ cat }: { cat: CategoryScore }) {
  return (
    <div className={`border rounded-xl p-4 ${cat.locked ? 'opacity-50' : 'border-gray-200'}`}>
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-semibold text-gray-900">{cat.label}</span>
        {cat.locked
          ? <span className="text-gray-400 text-lg">🔒</span>
          : <GradeBadge grade={cat.grade} />
        }
      </div>
      <ul className="space-y-1">
        {cat.details.map((d, i) => (
          <li key={i} className="text-xs text-gray-600">• {d}</li>
        ))}
      </ul>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function Audit() {
  const [step, setStep] = useState<Step>('form');
  const [businessName, setBusinessName] = useState('');
  const [city, setCity] = useState('');
  const [keyword, setKeyword] = useState('');
  const [email, setEmail] = useState('');
  const [scanId, setScanId] = useState('');
  const [audit, setAudit] = useState<AuditData | null>(null);
  const [error, setError] = useState('');
  const [capturing, setCapturing] = useState(false);

  const handleScan = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setStep('scanning');
    try {
      const res = await apiFetch<ScanResponse>('/audit/scan', {
        method: 'POST',
        body: JSON.stringify({ businessName, city, keyword: keyword || undefined }),
      });
      setScanId(res.data.scanId);
      setAudit(res.data.audit);
      setStep('results');
    } catch {
      setError('Something went wrong. Please try again.');
      setStep('form');
    }
  };

  const handleCapture = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setCapturing(true);
    try {
      const res = await apiFetch<CaptureResponse>('/audit/capture', {
        method: 'POST',
        body: JSON.stringify({ scanId, email }),
      });
      setAudit(res.data.audit);
      setStep('unlocked');
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setCapturing(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4">
      <div className="max-w-xl mx-auto">
        <div className="text-center mb-8">
          <Link to="/" className="text-xl font-bold text-brand-500">SuperLocalSEO</Link>
          <h1 className="mt-3 text-2xl font-bold text-gray-900">Free Local SEO Audit</h1>
          <p className="text-sm text-gray-500 mt-1">See how your business stacks up in under 30 seconds</p>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>
        )}

        {/* Step 1: Form */}
        {step === 'form' && (
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
            <form onSubmit={handleScan} className="space-y-4">
              <div>
                <label htmlFor="audit-businessName" className="block text-sm font-medium text-gray-700 mb-1">Business Name</label>
                <input
                  id="audit-businessName"
                  type="text"
                  value={businessName}
                  onChange={(e) => setBusinessName(e.target.value)}
                  required
                  placeholder="Acme Plumbing"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
              </div>
              <div>
                <label htmlFor="audit-city" className="block text-sm font-medium text-gray-700 mb-1">City / Area</label>
                <input
                  id="audit-city"
                  type="text"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  required
                  placeholder="Chicago, IL"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Main keyword <span className="text-gray-400 font-normal">(optional)</span>
                </label>
                <input
                  type="text"
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                  placeholder="plumber near me"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
              </div>
              <button
                type="submit"
                className="w-full bg-brand-500 text-white py-2.5 rounded-lg font-semibold text-sm hover:bg-brand-600"
              >
                Run Free Audit
              </button>
            </form>
          </div>
        )}

        {/* Step 2: Scanning */}
        {step === 'scanning' && (
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-12 text-center">
            <div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
            <p className="text-sm font-medium text-gray-700">Scanning {businessName}...</p>
            <p className="text-xs text-gray-400 mt-1">Checking Google profile, reviews, and more</p>
          </div>
        )}

        {/* Step 3: Results (locked) */}
        {step === 'results' && audit && (
          <div className="space-y-4">
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
              <div className="flex items-center justify-between mb-1">
                <div>
                  <h2 className="text-base font-bold text-gray-900">{audit.businessName ?? businessName}</h2>
                  {audit.formattedAddress && (
                    <p className="text-xs text-gray-500 mt-0.5">{audit.formattedAddress}</p>
                  )}
                </div>
                <div className="text-center">
                  <GradeBadge grade={audit.overallGrade} />
                  <p className="text-xs text-gray-400 mt-1">Overall</p>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3">
              {audit.categories.map((cat) => (
                <CategoryCard key={cat.label} cat={cat} />
              ))}
            </div>

            {/* Email gate */}
            <div className="bg-white rounded-xl border border-brand-200 shadow-sm p-6">
              <h3 className="text-sm font-semibold text-gray-900 mb-1">Unlock your full report</h3>
              <p className="text-xs text-gray-500 mb-4">Enter your email to unlock Keyword Rankings, Citations, and Competitor scores — plus a personalised action plan.</p>
              <form onSubmit={handleCapture} className="flex gap-2">
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  placeholder="you@example.com"
                  className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
                <button
                  type="submit"
                  disabled={capturing}
                  className="bg-brand-500 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-brand-600 disabled:opacity-60"
                >
                  {capturing ? 'Unlocking…' : 'Unlock'}
                </button>
              </form>
            </div>
          </div>
        )}

        {/* Step 4: Unlocked */}
        {step === 'unlocked' && audit && (
          <div className="space-y-4">
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
              <div className="flex items-center justify-between mb-1">
                <div>
                  <h2 className="text-base font-bold text-gray-900">{audit.businessName ?? businessName}</h2>
                  {audit.formattedAddress && (
                    <p className="text-xs text-gray-500 mt-0.5">{audit.formattedAddress}</p>
                  )}
                </div>
                <div className="text-center">
                  <GradeBadge grade={audit.overallGrade} />
                  <p className="text-xs text-gray-400 mt-1">Overall</p>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3">
              {audit.categories.map((cat) => (
                <CategoryCard key={cat.label} cat={cat} />
              ))}
            </div>

            <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6 text-center">
              <h3 className="text-sm font-semibold text-gray-900 mb-1">Start fixing these issues today</h3>
              <p className="text-xs text-gray-500 mb-4">SuperLocalSEO tracks rankings, reviews, and citations daily — and sends you a monthly report showing exactly what moved and why.</p>
              <Link
                to={`/register?email=${encodeURIComponent(email)}&business=${encodeURIComponent(businessName || audit.businessName || '')}`}
                className="inline-block bg-brand-500 text-white px-6 py-2.5 rounded-lg font-semibold text-sm hover:bg-brand-600"
              >
                Start free 14-day trial
              </Link>
              <p className="text-xs text-gray-400 mt-2">No credit card required</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
