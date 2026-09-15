import { Request, Response } from 'express';
import { placeDetails } from '../controllers/competitor.controller';
jest.mock('../config', () => ({ config: { ...jest.requireActual('../config').config, googlePlacesApiKey: 'fixture-key' } }));
afterEach(() => { jest.restoreAllMocks(); });
async function lookup(placeId = 'selected-place') {
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
  const next = jest.fn();
  await placeDetails({ query: { placeId } } as unknown as Request, res as unknown as Response, next);
  return { res, next };
}
it('fetches the selected listing name and website without fetching every search result', async () => {
  const fetcher = jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true, json: async () => ({ status: 'OK', result: { place_id: 'selected-place', name: 'Fitness LLC', website: 'https://fitness.example/' } }) } as globalThis.Response);
  const { res, next } = await lookup();
  expect(next).not.toHaveBeenCalled();
  expect(fetcher).toHaveBeenCalledTimes(1);
  const url = new URL(String(fetcher.mock.calls[0][0]));
  expect(url.searchParams.get('place_id')).toBe('selected-place');
  expect(url.searchParams.get('fields')).toBe('place_id,name,website');
  expect(res.json).toHaveBeenCalledWith({ success: true, data: { placeId: 'selected-place', name: 'Fitness LLC', website: 'https://fitness.example/' } });
});
it('returns null for an unlisted website', async () => {
  jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true, json: async () => ({ status: 'OK', result: { name: 'Fitness' } }) } as globalThis.Response);
  const { res } = await lookup();
  expect(res.json).toHaveBeenCalledWith({ success: true, data: { placeId: 'selected-place', name: 'Fitness', website: null } });
});
it('reports Google denial as an error without leaking its response or key', async () => {
  jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true, json: async () => ({ status: 'REQUEST_DENIED', error_message: 'secret provider detail' }) } as globalThis.Response);
  const { res } = await lookup(); expect(res.status).toHaveBeenCalledWith(502);
  expect(JSON.stringify(res.json.mock.calls)).not.toContain('secret provider detail');
});
it('rejects an empty selection before contacting Google', async () => {
  const fetcher = jest.spyOn(global, 'fetch');
  const { res } = await lookup(''); expect(res.status).toHaveBeenCalledWith(400); expect(fetcher).not.toHaveBeenCalled();
});
