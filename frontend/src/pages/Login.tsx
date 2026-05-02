import { useState } from 'react';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

const GOOGLE_AUTH_URL = '/api/auth/google';

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [googleOnlyHint, setGoogleOnlyHint] = useState(false);
  const [noAccountHint, setNoAccountHint] = useState(false);

  const oauthError = searchParams.get('error');
  const [error, setError] = useState(
    oauthError === 'google_failed' ? 'Google sign-in failed. Please try again.' :
    oauthError === 'google_cancelled' ? 'Google sign-in was cancelled.' : '',
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setGoogleOnlyHint(false);
    setNoAccountHint(false);
    setLoading(true);
    try {
      await login(email, password);
      navigate('/dashboard');
    } catch (err) {
      const e = err as Error & { code?: string };
      if (e.code === 'USE_GOOGLE_LOGIN') {
        setGoogleOnlyHint(true);
      } else if (e.code === 'USER_NOT_FOUND') {
        setNoAccountHint(true);
      } else {
        setError('Invalid email or password');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <Link to="/" className="text-2xl font-bold text-brand-500">SuperLocalSEO</Link>
          <h1 className="mt-4 text-2xl font-bold text-gray-900">Sign in to your account</h1>
        </div>
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8">
          {noAccountHint && (
            <div className="mb-4 p-4 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
              <p className="font-medium mb-1">No account found for that email.</p>
              <p className="mb-3 text-amber-700">Want to get started with a free 14-day trial?</p>
              <Link
                to={`/register?email=${encodeURIComponent(email)}`}
                className="inline-block bg-brand-500 text-white px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-brand-600"
              >
                Create account →
              </Link>
            </div>
          )}
          {googleOnlyHint && (
            <div className="mb-4 p-4 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-800">
              <p className="font-medium mb-1">This account uses Google sign-in.</p>
              <p className="mb-3 text-blue-700">No password is set — use the button below to sign in.</p>
              <a href={GOOGLE_AUTH_URL} className="inline-flex items-center gap-2 bg-white border border-blue-300 text-blue-700 px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-blue-50">
                <GoogleIcon />
                Sign in with Google
              </a>
            </div>
          )}
          {error && <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>}

          {/* Google OAuth */}
          <a
            href={GOOGLE_AUTH_URL}
            className="flex items-center justify-center gap-3 w-full border border-gray-300 rounded-lg px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors mb-6"
          >
            <GoogleIcon />
            Sign in with Google
          </a>

          <div className="relative mb-6">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-gray-200" />
            </div>
            <div className="relative flex justify-center text-xs">
              <span className="bg-white px-3 text-gray-400">or continue with email</span>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label htmlFor="login-email" className="block text-sm font-medium text-gray-700 mb-1">Email</label>
              <input id="login-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <label htmlFor="login-password" className="block text-sm font-medium text-gray-700">Password</label>
                <Link to="/auth/forgot-password" className="text-xs text-brand-500 hover:underline">Forgot password?</Link>
              </div>
              <input id="login-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
            </div>
            <button type="submit" disabled={loading}
              className="w-full bg-brand-500 text-white py-2.5 rounded-lg font-semibold text-sm hover:bg-brand-600 disabled:opacity-50 transition-colors">
              {loading ? 'Signing in...' : 'Sign in'}
            </button>
          </form>
          <p className="mt-6 text-center text-sm text-gray-600">
            Don't have an account?{' '}
            <Link to="/register" className="text-brand-500 font-medium hover:underline">Start free trial</Link>
          </p>
        </div>
      </div>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M17.64 9.205c0-.639-.057-1.252-.164-1.841H9v3.481h4.844a4.14 4.14 0 01-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4"/>
      <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 009 18z" fill="#34A853"/>
      <path d="M3.964 10.71A5.41 5.41 0 013.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 000 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05"/>
      <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 00.957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
    </svg>
  );
}
