import type { EMRConnectLink } from './embedmyreviews.service';

/** Connection history is not a live token-health check. Counts never determine selection. */
export function connectionState(links: EMRConnectLink[], now = Date.now()) {
  const latest = links[0]; // Provider's documented newest-first order.
  const selected = links.find(l => l.status === 'used' && l.usedAt);
  const active = links.find(l => l.status === 'active' && (!l.expiresAt || new Date(l.expiresAt).getTime() > now));
  const phase = latest?.status === 'active' && !active ? 'expired'
    : active ? active.completedOauthAt ? 'select_business' : 'awaiting_authorization'
    : selected ? 'profile_selected'
    : latest?.status === 'expired' ? 'expired'
    : latest?.status === 'revoked' ? 'revoked' : 'not_started';
  return { phase, profileSelected: !!selected, selectedAt: selected?.usedAt ?? null,
    oauthCompletedAt: latest?.completedOauthAt ?? null, connectUrl: active?.connectUrl ?? null,
    expiresAt: active?.expiresAt ?? null };
}

export function safeConnectUrl(value: string, baseUrl: string): string {
  const url = new URL(value);
  if (url.origin !== new URL(baseUrl).origin || url.protocol !== 'https:' || !/^\/connect\/[A-Za-z0-9-]+$/.test(url.pathname) || url.username || url.password) {
    throw new Error('Unexpected connection destination');
  }
  return url.href;
}
