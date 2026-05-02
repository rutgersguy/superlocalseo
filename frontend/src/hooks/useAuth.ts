import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { apiFetch, setAccessToken, refreshToken } from '../services/api';

interface AuthState {
  userId: string | null;
  role: string | null;
  isAuthenticated: boolean;
  loading: boolean;
}

interface AuthContext extends AuthState {
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  register: (email: string, password: string, businessName: string) => Promise<void>;
  setToken: (token: string) => void;
}

export const AuthCtx = createContext<AuthContext>({
  userId: null, role: null, isAuthenticated: false, loading: true,
  login: async () => {}, logout: async () => {}, register: async () => {}, setToken: () => {},
});

export function useAuth(): AuthContext {
  return useContext(AuthCtx);
}

function decodeJwt(token: string): { userId: string; role: string } {
  const payload = JSON.parse(atob(token.split('.')[1]));
  return { userId: payload.userId, role: payload.role ?? 'client' };
}

export function useAuthState() {
  const [state, setState] = useState<AuthState>({ userId: null, role: null, isAuthenticated: false, loading: true });

  // On mount, attempt a silent token refresh using the httpOnly refresh cookie.
  // Uses the shared refreshToken() singleton so this never races with the 401 interceptor.
  useEffect(() => {
    refreshToken()
      .then((token) => {
        if (token) {
          const { userId, role } = decodeJwt(token);
          setState({ userId, role, isAuthenticated: true, loading: false });
        } else {
          // If setToken() already ran (e.g. Google OAuth callback), preserve that auth state
          setState((prev) =>
            prev.isAuthenticated
              ? { ...prev, loading: false }
              : { userId: null, role: null, isAuthenticated: false, loading: false }
          );
        }
      })
      .catch(() => {
        setState((prev) =>
          prev.isAuthenticated
            ? { ...prev, loading: false }
            : { userId: null, role: null, isAuthenticated: false, loading: false }
        );
      });
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const res = await apiFetch<{ success: boolean; data: { accessToken: string }; error?: { message: string; code: string } }>('/auth/login', {
      method: 'POST', body: JSON.stringify({ email, password }),
    });
    if (!res.success) throw Object.assign(new Error(res.error?.message ?? 'Login failed'), { code: res.error?.code });
    setAccessToken(res.data.accessToken);
    const { userId, role } = decodeJwt(res.data.accessToken);
    setState({ userId, role, isAuthenticated: true, loading: false });
  }, []);

  const logout = useCallback(async () => {
    await apiFetch('/auth/logout', { method: 'POST' }).catch(() => {});
    setAccessToken(null);
    setState({ userId: null, role: null, isAuthenticated: false, loading: false });
  }, []);

  const register = useCallback(async (email: string, password: string, businessName: string) => {
    const res = await apiFetch<{ success: boolean; error?: { message: string; code: string; hint?: string } }>('/auth/register', {
      method: 'POST', body: JSON.stringify({ email, password, businessName }),
    });
    if (!res.success) {
      const e = Object.assign(new Error(res.error?.message ?? 'Registration failed'), {
        code: res.error?.code,
        hint: res.error?.hint,
      });
      throw e;
    }
  }, []);

  const setToken = useCallback((token: string) => {
    setAccessToken(token);
    const { userId, role } = decodeJwt(token);
    setState({ userId, role, isAuthenticated: true, loading: false });
  }, []);

  return { ...state, login, logout, register, setToken };
}
