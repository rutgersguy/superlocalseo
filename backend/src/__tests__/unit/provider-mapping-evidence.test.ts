import { readProviderMappingEvidence } from '../../services/provider_mapping_evidence';
import { config } from '../../config';
const inspection = () => ({ providerPageUrl: 'https://app.superlocalseo.com/sources', businessName: 'Fixture Business', inspectedAt: new Date().toISOString(), selectedLocationConfirmed: true as const, exactPlaceIdConfirmed: true as const, customerOwnershipConfirmed: true as const });
const originalFetch = global.fetch;
const originalKey = config.embedmyreviews.apiKey;
const originalBase = config.embedmyreviews.baseUrl;
const fetchSpy = jest.fn();
beforeEach(() => { Object.assign(config.embedmyreviews, { apiKey: 'fixture-key', baseUrl: 'https://app.superlocalseo.com' }); global.fetch = fetchSpy; fetchSpy.mockReset().mockResolvedValue({ ok: true, json: async () => ({ data: { id: 33, organization_id: 26, name: 'Fixture workspace' } }) }); });
afterAll(() => { global.fetch = originalFetch; Object.assign(config.embedmyreviews, { apiKey: originalKey, baseUrl: originalBase }); });
it('combines live membership with explicitly labelled operator evidence', async () => {
  const result = await readProviderMappingEvidence('26', '33', 'ChIJ-fixture', inspection());
  expect(result).toMatchObject({ membershipVerified: true, googleIdentityVerification: 'operator_attested', providerLocationName: 'Fixture workspace', inspection: { businessName: 'Fixture Business' } });
  expect(fetchSpy).toHaveBeenCalledWith('https://app.superlocalseo.com/api/v1/locations/33', expect.objectContaining({ redirect: 'error' }));
});
it.each([
  undefined,
  { ...inspection(), inspectedAt: new Date(Date.now() - 31 * 60000).toISOString() },
  { ...inspection(), inspectedAt: new Date(Date.now() + 5 * 60000).toISOString() },
  { ...inspection(), providerPageUrl: 'https://evil.example/sources' },
  { ...inspection(), providerPageUrl: 'https://app.superlocalseo.com/sources?token=secret' },
  { ...inspection(), providerPageUrl: 'https://app.superlocalseo.com/login' },
  { ...inspection(), exactPlaceIdConfirmed: false },
])('rejects incomplete, stale, future or unsafe inspection before calling provider (%#)', async value => {
  await expect(readProviderMappingEvidence('26', '33', 'ChIJ-fixture', value as any)).rejects.toMatchObject({ status: 409 });
  expect(fetchSpy).not.toHaveBeenCalled();
});
it.each([
  { id: 33, organization_id: 99, name: 'Foreign workspace' },
  { id: 34, organization_id: 26, name: 'Another location' },
])('rejects incorrect provider membership', async data => {
  fetchSpy.mockResolvedValue({ ok: true, json: async () => ({ data }) });
  await expect(readProviderMappingEvidence('26', '33', 'ChIJ-fixture', inspection())).rejects.toMatchObject({ status: 409 });
});
it.each([401, 403, 429, 500])('does not save on provider error %s', async status => {
  fetchSpy.mockResolvedValue({ ok: false, status });
  await expect(readProviderMappingEvidence('26', '33', 'ChIJ-fixture', inspection())).rejects.toMatchObject({ status: 502 });
});
it('handles malformed responses and network failures safely', async () => {
  fetchSpy.mockResolvedValue({ ok: true, json: async () => ({ data: {} }) });
  await expect(readProviderMappingEvidence('26', '33', 'ChIJ-fixture', inspection())).rejects.toMatchObject({ status: 502 });
  fetchSpy.mockRejectedValue(new Error('secret upstream detail'));
  await expect(readProviderMappingEvidence('26', '33', 'ChIJ-fixture', inspection())).rejects.toMatchObject({ status: 502, message: 'Provider membership could not be checked. Retry before saving.' });
});
it('requires API configuration', async () => {
  Object.assign(config.embedmyreviews, { apiKey: '' });
  await expect(readProviderMappingEvidence('26', '33', 'ChIJ-fixture', inspection())).rejects.toMatchObject({ status: 503 });
  expect(fetchSpy).not.toHaveBeenCalled();
});
