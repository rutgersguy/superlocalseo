import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

export default function AuthGoogleSuccess() {
  const [searchParams] = useSearchParams();
  const { setToken } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    const token = searchParams.get('token');
    const error = searchParams.get('error');

    if (error || !token) {
      navigate('/login?error=google_failed', { replace: true });
      return;
    }

    setToken(token);

    const status = searchParams.get('status');
    if (status === 'new') {
      navigate('/onboarding', { replace: true });
    } else if (status === 'linked') {
      navigate('/dashboard?linked=1', { replace: true });
    } else {
      navigate('/dashboard', { replace: true });
    }
  }, []);

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="text-center">
        <div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
        <p className="text-sm text-gray-500">Signing you in...</p>
      </div>
    </div>
  );
}
