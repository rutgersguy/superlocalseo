import { connectionState, safeConnectUrl } from '../../services/emr_connection_state';
import type { EMRConnectLink } from '../../services/embedmyreviews.service';
const base: EMRConnectLink = { token: 'test', provider: 'google', locationId: 33, connectUrl: 'https://app.superlocalseo.com/connect/test', status: 'active', completedOauthAt: null, usedAt: null, createdAt: null, expiresAt: '2030-01-01T00:00:00Z' };

describe('Google connection lifecycle evidence', () => {
  it('does not confuse authorization with profile selection', () => {
    expect(connectionState([{ ...base, completedOauthAt: '2026-09-09T00:00:00Z' }])).toMatchObject({ phase: 'select_business', profileSelected: false });
  });
  it('recognizes selected zero-review profiles without requiring any review count', () => {
    expect(connectionState([{ ...base, status: 'used', usedAt: '2026-09-09T00:00:00Z' }])).toMatchObject({ phase: 'profile_selected', profileSelected: true, connectUrl: null });
  });
  it('keeps a reconnect in progress visible even when an older selection exists', () => {
    expect(connectionState([base, { ...base, status: 'used', usedAt: '2026-09-08T00:00:00Z' }])).toMatchObject({ phase: 'awaiting_authorization', profileSelected: true });
  });
  it('does not offer an expired active link', () => {
    expect(connectionState([{ ...base, expiresAt: '2020-01-01T00:00:00Z' }])).toMatchObject({ phase: 'expired', connectUrl: null });
  });
  it('distinguishes revoked and never-started connections', () => {
    expect(connectionState([{ ...base, status: 'revoked' }]).phase).toBe('revoked');
    expect(connectionState([]).phase).toBe('not_started');
  });
  it('rejects foreign origins, credentials and non-connection paths', () => {
    for (const url of ['https://evil.example/connect/test', 'https://user:pass@app.superlocalseo.com/connect/test', 'https://app.superlocalseo.com/login', 'http://app.superlocalseo.com/connect/test']) {
      expect(() => safeConnectUrl(url, 'https://app.superlocalseo.com')).toThrow();
    }
    expect(safeConnectUrl(base.connectUrl, 'https://app.superlocalseo.com')).toBe(base.connectUrl);
  });
});
