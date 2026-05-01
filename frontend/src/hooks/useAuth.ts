import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { apiFetch, setAccessToken } from '../services/api';

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
  useEffect(() => {
    apiFetch<{ success: boolean; data?: { accessToken: string } }>('/auth/refresh', { method: 'POST' })
      .then((res) => {
        if (res.success && res.data?.accessToken) {
          setAccessToken(res.data.accessToken);
          const { userId, role } = decodeJwt(res.data.accessToken);
          setState({ userId, role, isAuthenticated: true, loading: false });
        } else {
          setState({ userId: null, role: null, isAuthenticated: false, loading: false });
        }
      })
      .catch(() => {
        setState({ userId: null, role: null, isAuthenticated: false, loading: false });
      });
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const res = await apiFetch<{ success: boolean; data: { accessToken: string } }>('/auth/login', {
      method: 'POST', body: JSON.stringify({ email, password }),
    });
    if (!res.success) throw new Error('Login failed');
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
    const res = await apiFetch<{ success: boolean; message?: string }>('/auth/register', {
      method: 'POST', body: JSON.stringify({ email, password, businessName }),
    });
    if (!res.success) throw new Error(res.message ?? 'Registration failed');
  }, []);

  const setToken = useCallback((token: string) => {
    setAccessToken(token);
    const { userId, role } = decodeJwt(token);
    setState({ userId, role, isAuthenticated: true, loading: false });
  }, []);

  return { ...state, login, logout, register, setToken };
}
