import { Link, useLocation } from 'react-router-dom';

export default function RegisterSuccess() {
  const location = useLocation();
  const email = (location.state as { email?: string } | null)?.email ?? '';

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <Link to="/"><img src="/sls_logo_wide_color.png" alt="SuperLocalSEO" className="h-10 w-auto mx-auto" /></Link>
        </div>
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 text-center">
          <div className="w-14 h-14 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-5">
            <svg className="w-7 h-7 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
          </div>

          <h1 className="text-2xl font-bold text-gray-900 mb-2">Check your email</h1>
          <p className="text-gray-600 text-sm mb-1">
            Thanks for signing up! We sent a verification link to
          </p>
          {email && (
            <p className="font-semibold text-gray-900 text-sm mb-4">{email}</p>
          )}
          <p className="text-gray-600 text-sm mb-8">
            Click the link in that email to verify your account, then sign in below.
          </p>

          <Link
            to="/login"
            className="block w-full bg-brand-500 text-white py-2.5 rounded-lg font-semibold text-sm hover:bg-brand-600 transition-colors text-center"
          >
            Go to sign in
          </Link>

          <p className="mt-5 text-xs text-gray-400">
            Didn't receive it? Check your spam folder, or{' '}
            <Link to="/register" className="text-brand-500 hover:underline">
              try a different email
            </Link>
            .
          </p>
        </div>
      </div>
    </div>
  );
}
