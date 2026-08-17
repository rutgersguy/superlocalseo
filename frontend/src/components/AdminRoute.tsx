import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

/**
 * Route guard for the operator console.
 *
 * `/admin` previously sat behind ProtectedRoute only, which checks authentication
 * but not role. The nav link is hidden for non-admins, so it looked guarded — but
 * any logged-in client who typed the URL rendered the entire Admin shell. The API
 * correctly 403s every panel, so no customer data leaked; what leaked was the
 * operator feature surface: tab names, section headings, and the shape of
 * internal tooling (Promo Codes, Job Queues, Citation Builder, Customers).
 *
 * Flagged as DISC-4 in docs/FRONTEND_TEST_SUITE.md and never resolved (issue #156).
 *
 * `role` is decoded from the JWT (useAuth), so this needs no extra fetch.
 */
export default function AdminRoute() {
  const { isAuthenticated, role, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-brand-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!isAuthenticated) return <Navigate to="/login" replace />;
  // Send non-admins to their own dashboard rather than /login — they ARE
  // authenticated, they simply have no business here.
  if (role !== 'admin') return <Navigate to="/dashboard" replace />;

  return <Outlet />;
}
