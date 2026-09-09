const API_BASE = '/api';

type ApiFailure = { code?: string; error?: string | { code?: string; message?: string } };
function failureMessage(body: ApiFailure, fallback: string): string {
  return (typeof body.error === 'string' ? body.error : body.error?.message) || fallback;
}

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

  let res = await fetch(`${API_BASE}${path}`, { ...init, headers, credentials: 'include' });

  // Silent token refresh on 401 — deduplicated so concurrent 401s share one refresh call
  if (res.status === 401 && path !== '/auth/refresh' && path !== '/auth/login' && path !== '/auth/register') {
    const newToken = await refreshToken();
    if (newToken) {
      headers['Authorization'] = `Bearer ${newToken}`;
      res = await fetch(`${API_BASE}${path}`, { ...init, headers, credentials: 'include' });
    } else {
      window.location.href = '/login';
    }
  }

  // Both initial responses and refreshed retries use the same subscription handling.
  // Middleware emits both flat and nested error envelopes; neither is valid data.
  if (res.status === 402) {
    const body = await res.json() as ApiFailure;
    const code = typeof body.error === 'object' ? body.error?.code : body.code;
    if (code && ['TRIAL_EXPIRED', 'PAYMENT_FAILED', 'PAYMENT_OVERDUE',
      'SUBSCRIPTION_CANCELED', 'SUBSCRIPTION_CANCELLED'].includes(code)) {
      window.location.href = '/billing';
    }
    throw new Error(failureMessage(body, 'Subscription access is restricted.'));
  }

  if (rawResponse) return res;
  if (res.status === 204) return null as T;

  const ct = res.headers.get('content-type') ?? '';
  if (!ct.includes('application/json')) {
    throw new Error(`Server error (${res.status}) — please try again.`);
  }
  return res.json();
}

// SWR fetcher — typed as returning Promise<T> so useSWR<T> inference works
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const fetcher = async <T = any>(path: string): Promise<T> => {
  const body = await apiFetch<T>(path);
  if (body && typeof body === 'object' && 'success' in body && body.success === false) {
    throw new Error(failureMessage(body as ApiFailure, 'Unable to load data. Please try again.'));
  }
  return body;
};
