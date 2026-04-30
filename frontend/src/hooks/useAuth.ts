import { createContext, useContext, useState, useCallback } from 'react';
import { apiFetch, setAccessToken } from '../services/api';

interface AuthState {
  userId: string | null;
  isAuthenticated: boolean;
}

interface AuthContext extends AuthState {
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

export const AuthCtx = createContext<AuthContext>({
  userId: null, isAuthenticated: false,
  login: async () => {}, logout: async () => {},
});

export function useAuth(): AuthContext {
  return useContext(AuthCtx);
}

export function useAuthState() {
  const [state, setState] = useState<AuthState>({ userId: null, isAuthenticated: false });

  const login = useCallback(async (email: string, password: string) => {
    const res = await apiFetch<{ success: boolean; data: { accessToken: string } }>('/auth/login', {
      method: 'POST', body: JSON.stringify({ email, password }),
    });
    if (!res.success) throw new Error('Login failed');
    setAccessToken(res.data.accessToken);
    // Decode userId from token (simple base64 parse — no verification needed client-side)
    const payload = JSON.parse(atob(res.data.accessToken.split('.')[1]));
    setState({ userId: payload.userId, isAuthenticated: true });
  }, []);

  const logout = useCallback(async () => {
    await apiFetch('/auth/logout', { method: 'POST' }).catch(() => {});
    setAccessToken(null);
    setState({ userId: null, isAuthenticated: false });
  }, []);

  return { ...state, login, logout };
}
