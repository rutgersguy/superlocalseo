import { useEffect, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { apiFetch } from '../services/api';

type Status = 'loading' | 'success' | 'error';

export default function VerifyEmail() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') ?? '';
  const [status, setStatus] = useState<Status>('loading');
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    if (!token) {
      setErrorMsg('No verification token found.');
      setStatus('error');
      return;
    }

    apiFetch<{ success: boolean; error?: { message?: string } }>(`/auth/verify?token=${encodeURIComponent(token)}`)
      .then((res) => {
        if (res.success) {
          setStatus('success');
        } else {
          setErrorMsg(res.error?.message ?? 'This verification link is invalid or has expired.');
          setStatus('error');
        }
      })
      .catch((err: unknown) => {
        setErrorMsg(err instanceof Error ? err.message : 'Verification failed.');
        setStatus('error');
      });
  }, [token]);

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <Link to="/"><img src="/sls_logo_wide_color.png" alt="SuperLocalSEO" className="h-10 w-auto mx-auto" /></Link>
        </div>
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 text-center">
          {status === 'loading' && (
            <>
              <div className="w-12 h-12 border-4 border-brand-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
              <p className="text-gray-600">Verifying your email...</p>
            </>
          )}
          {status === 'success' && (
            <>
              <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h2 className="text-xl font-semibold text-gray-900 mb-2">Email verified!</h2>
              <p className="text-sm text-gray-600 mb-6">
                Your email has been verified. You can now log in to your account.
              </p>
              <Link
                to="/login"
                className="inline-block bg-brand-500 text-white px-6 py-2.5 rounded-lg font-semibold text-sm hover:bg-brand-600 transition-colors"
              >
                Go to sign in
              </Link>
            </>
          )}
          {status === 'error' && (
            <>
              <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-6 h-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </div>
              <h2 className="text-xl font-semibold text-gray-900 mb-2">Verification failed</h2>
              <p className="text-sm text-gray-600 mb-6">{errorMsg}</p>
              <Link to="/login" className="text-sm text-brand-500 font-medium hover:underline">
                Back to sign in
              </Link>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
