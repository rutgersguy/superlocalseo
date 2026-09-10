import { readProviderMappingEvidence } from '../../services/provider_mapping_evidence';

it('fails closed while the provider identity contract is unverified and does not call a provider', async () => {
  const original = global.fetch;
  const fetchSpy = jest.fn();
  global.fetch = fetchSpy;
  try {
    await expect(readProviderMappingEvidence('880001', '880002', 'ChIJ-fixture')).rejects.toMatchObject({ status: 409 });
    expect(fetchSpy).not.toHaveBeenCalled();
  } finally { global.fetch = original; }
});
