import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { apiFetch } from '../services/api';
import { useAuth } from '../hooks/useAuth';

interface InviteInfo {
  memberId: string;
  clientId: string;
  email: string;
  role: string;
}

export default function TeamAccept() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') ?? '';
  const navigate = useNavigate();
  const { setToken } = useAuth();

  const [step, setStep] = useState<'loading' | 'form' | 'error'>('loading');
  const [invite, setInvite] = useState<InviteInfo | null>(null);
  const [errorMsg, setErrorMsg] = useState('');

  // Form state
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');

  useEffect(() => {
    if (!token) {
      setErrorMsg('Missing invite token.');
      setStep('error');
      return;
    }

    apiFetch<{ success: boolean; data?: InviteInfo; error?: { message: string } }>(
      `/team/accept?token=${encodeURIComponent(token)}`
    ).then((res) => {
      if (res.success && res.data) {
        setInvite(res.data);
        setStep('form');
      } else {
        setErrorMsg((res as { error?: { message: string } }).error?.message ?? 'Invalid or expired invite link.');
        setStep('error');
      }
    }).catch(() => {
      setErrorMsg('Failed to verify invite. Please try again.');
      setStep('error');
    });
  }, [token]);

  const accept = async () => {
    setSubmitting(true);
    setFormError('');
    try {
      const body: Record<string, string> = { token };
      if (name) body.name = name;
      if (password) body.password = password;

      const res = await apiFetch<{ success: boolean; data?: { accessToken: string }; error?: { message: string } }>(
        '/team/accept',
        { method: 'POST', body: JSON.stringify(body) }
      );

      if (res.success && res.data?.accessToken) {
        setToken(res.data.accessToken);
        navigate('/dashboard');
      } else {
        setFormError((res as { error?: { message: string } }).error?.message ?? 'Failed to accept invite.');
      }
    } catch {
      setFormError('Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  if (step === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-brand-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (step === 'error') {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="max-w-md w-full text-center space-y-4">
          <h1 className="text-2xl font-bold text-gray-900">Invite link invalid</h1>
          <p className="text-gray-500">{errorMsg}</p>
          <a href="/login" className="text-brand-500 hover:underline text-sm">Go to login</a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="max-w-md w-full space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-900">Accept team invitation</h1>
          <p className="text-gray-500 mt-2">
            You've been invited to join as a <strong className="capitalize">{invite?.role}</strong>.
          </p>
          <p className="text-sm text-gray-400 mt-1">{invite?.email}</p>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Your name (optional)</label>
            <input
              type="text"
              placeholder="Jane Smith"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Password <span className="text-gray-400 font-normal">(required if new to SuperLocalSEO)</span>
            </label>
            <input
              type="password"
              placeholder="At least 8 characters"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
            <p className="text-xs text-gray-400 mt-1">Already have an account? Leave this blank.</p>
          </div>

          {formError && <p className="text-sm text-red-600">{formError}</p>}

          <button
            onClick={() => void accept()}
            disabled={submitting}
            className="w-full bg-brand-500 text-white py-2.5 rounded-lg text-sm font-semibold hover:bg-brand-600 disabled:opacity-50"
          >
            {submitting ? 'Accepting...' : 'Accept invitation'}
          </button>
        </div>
      </div>
    </div>
  );
}
