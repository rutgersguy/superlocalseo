jest.mock('../../config', () => ({ config: { dataforseo: { login: 'fixture', password: 'fixture' }, nodeEnv: 'test' } }));
import { getRankForCoordinate } from '../../services/dataforseo.service';
const params = { keyword: 'trainer', lat: 36, lng: -96, businessName: 'Trainer' };
describe('initial map source validity', () => {
  const original = global.fetch;
  afterEach(() => { global.fetch = original; });
  function response(task: unknown) { global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ tasks: [task] }) }); }
  it('does not convert missing results to unranked', async () => {
    response({ status_code: 20000, result: null });
    await expect(getRankForCoordinate(params)).rejects.toThrow('unavailable');
  });
  it('does not convert malformed items to unranked', async () => {
    response({ status_code: 20000, result: [{}] });
    await expect(getRankForCoordinate(params)).rejects.toThrow('unavailable');
  });
  it('does not convert a provider rejection to unranked', async () => {
    response({ status_code: 40501, result: [{ items: [] }] });
    await expect(getRankForCoordinate(params)).rejects.toThrow('unavailable');
  });
  it('accepts an explicitly empty observed result', async () => {
    response({ status_code: 20000, result: [{ items_count: 0, items: null }] });
    expect(await getRankForCoordinate(params)).toMatchObject({ rank: null });
  });

it('uses provider precision and an explicit neighborhood zoom instead of the empty-result default', async () => {
  response({ status_code: 20000, result: [{ items_count: 0, items: [] }] });
  await getRankForCoordinate({ keyword: 'hvac company Tulsa', lat: 36.0216747, lng: -96.00849750569192, businessName: 'QA' });
  const body = JSON.parse((global.fetch as jest.Mock).mock.calls.at(-1)[1].body);
  expect(body[0].location_coordinate).toBe('36.0216747,-96.0084975,15z');
  expect(body[0].depth).toBe(50);
});

});
