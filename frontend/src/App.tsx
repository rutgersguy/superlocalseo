import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthCtx, useAuthState } from './hooks/useAuth';
import Landing from './pages/Landing';
import Login from './pages/Login';
import Register from './pages/Register';
import RegisterSuccess from './pages/RegisterSuccess';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';
import VerifyEmail from './pages/VerifyEmail';
import AuthGoogleSuccess from './pages/AuthGoogleSuccess';
import Audit from './pages/Audit';
import Onboarding from './pages/Onboarding';
import DashboardLayout from './layouts/DashboardLayout';
import Dashboard from './pages/Dashboard';
import Rankings from './pages/Rankings';
import Reviews from './pages/Reviews';
import Citations from './pages/Citations';
import Settings from './pages/Settings';
import Reports from './pages/Reports';
import ProtectedRoute from './components/ProtectedRoute';
import ErrorBoundary from './components/ErrorBoundary';

function App() {
  const auth = useAuthState();

  return (
    <ErrorBoundary>
    <AuthCtx.Provider value={auth}>
      <BrowserRouter>
        <Routes>
          {/* Public routes */}
          <Route path="/" element={<Landing />} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/registered" element={<RegisterSuccess />} />
          <Route path="/auth/verify-email" element={<VerifyEmail />} />
          <Route path="/auth/forgot-password" element={<ForgotPassword />} />
          <Route path="/auth/reset-password" element={<ResetPassword />} />
          <Route path="/auth/google/success" element={<AuthGoogleSuccess />} />
          <Route path="/audit" element={<Audit />} />

          {/* Protected routes */}
          <Route element={<ProtectedRoute />}>
            <Route path="/onboarding" element={<Onboarding />} />
            <Route path="/dashboard" element={<DashboardLayout />}>
              <Route index element={<Dashboard />} />
              <Route path="rankings" element={<Rankings />} />
              <Route path="reviews" element={<Reviews />} />
              <Route path="citations" element={<Citations />} />
              <Route path="reports" element={<Reports />} />
              <Route path="settings" element={<Settings />} />
            </Route>
          </Route>

          {/* Catch-all */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthCtx.Provider>
    </ErrorBoundary>
  );
}

export default App;
