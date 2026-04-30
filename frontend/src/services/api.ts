const API_BASE = '/api';

let _accessToken: string | null = null;

export function setAccessToken(token: string | null): void {
  _accessToken = token;
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init.headers as Record<string, string> ?? {}),
  };
  if (_accessToken) headers['Authorization'] = `Bearer ${_accessToken}`;

  const res = await fetch(`${API_BASE}${path}`, { ...init, headers, credentials: 'include' });

  // Silent token refresh on 401
  if (res.status === 401 && path !== '/auth/refresh') {
    const refreshed = await fetch(`${API_BASE}/auth/refresh`, { method: 'POST', credentials: 'include' });
    if (refreshed.ok) {
      const { data } = await refreshed.json();
      setAccessToken(data.accessToken);
      headers['Authorization'] = `Bearer ${data.accessToken}`;
      const retry = await fetch(`${API_BASE}${path}`, { ...init, headers, credentials: 'include' });
      return retry.json();
    } else {
      setAccessToken(null);
      window.location.href = '/login';
    }
  }

  return res.json();
}

// SWR fetcher — typed as returning Promise<T> so useSWR<T> inference works
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const fetcher = <T = any>(path: string): Promise<T> => apiFetch<T>(path);
