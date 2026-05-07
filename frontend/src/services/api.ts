const API_BASE = '/api';

let _accessToken: string | null = null;
let _refreshPromise: Promise<string | null> | null = null;

export function setAccessToken(token: string | null): void {
  _accessToken = token;
}

export function refreshToken(): Promise<string | null> {
  if (_refreshPromise) return _refreshPromise;
  _refreshPromise = fetch(`${API_BASE}/auth/refresh`, { method: 'POST', credentials: 'include' })
    .then(async (res) => {
      if (res.ok) {
        const body = await res.json() as { data: { accessToken: string } };
        setAccessToken(body.data.accessToken);
        return body.data.accessToken;
      }
      // Don't clear _accessToken here — caller decides what to do on failure
      return null;
    })
    .finally(() => { _refreshPromise = null; });
  return _refreshPromise;
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T>;
export async function apiFetch<T>(path: string, init: RequestInit, rawResponse: true): Promise<Response>;
export async function apiFetch<T>(path: string, init: RequestInit = {}, rawResponse?: true): Promise<T | Response> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init.headers as Record<string, string> ?? {}),
  };
  if (_accessToken) headers['Authorization'] = `Bearer ${_accessToken}`;

  const res = await fetch(`${API_BASE}${path}`, { ...init, headers, credentials: 'include' });

  // Hard gate: trial expired or subscription canceled/overdue — redirect to billing
  if (res.status === 402) {
    const body = await res.json() as { code?: string };
    if (body.code === 'TRIAL_EXPIRED' || body.code === 'SUBSCRIPTION_CANCELED' || body.code === 'PAYMENT_OVERDUE') {
      window.location.href = '/dashboard/settings?tab=billing';
      return body as T;
    }
    return body as T;
  }

  // Silent token refresh on 401 — deduplicated so concurrent 401s share one refresh call
  if (res.status === 401 && path !== '/auth/refresh' && path !== '/auth/login' && path !== '/auth/register') {
    const newToken = await refreshToken();
    if (newToken) {
      headers['Authorization'] = `Bearer ${newToken}`;
      const retry = await fetch(`${API_BASE}${path}`, { ...init, headers, credentials: 'include' });
      if (rawResponse) return retry;
      const retryCt = retry.headers.get('content-type') ?? '';
      if (!retryCt.includes('application/json')) throw new Error(`Server error (${retry.status}) — please try again.`);
      return retry.json();
    } else {
      window.location.href = '/login';
    }
  }

  if (rawResponse) return res;

  const ct = res.headers.get('content-type') ?? '';
  if (!ct.includes('application/json')) {
    throw new Error(`Server error (${res.status}) — please try again.`);
  }
  return res.json();
}

// SWR fetcher — typed as returning Promise<T> so useSWR<T> inference works
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const fetcher = <T = any>(path: string): Promise<T> => apiFetch<T>(path);
