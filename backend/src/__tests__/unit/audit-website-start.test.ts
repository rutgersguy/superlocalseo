jest.mock('../../db/connection', () => ({ db: jest.fn() }));
jest.mock('../../services/onpage.service', () => ({ checkOnPageSeo: jest.fn() }));
jest.mock('../../services/dataforseo.service', () => ({ submitLighthouseTask: jest.fn() }));
jest.mock('../../services/brightlocal.service', () => ({ createAuditReport: jest.fn() }));
import { db } from '../../db/connection';
import { checkOnPageSeo } from '../../services/onpage.service';
import { submitLighthouseTask } from '../../services/dataforseo.service';
import { computeAuditScores } from '../../services/audit_score.service';
import { trigger } from '../../controllers/audit_bl.controller';

function query(value: unknown) {
  const q: any = {};
  for (const method of ['where', 'select', 'distinctOn']) q[method] = jest.fn(() => q);
  q.first = jest.fn().mockResolvedValue(value);
  q.orderByRaw = jest.fn().mockResolvedValue(value);
  return q;
}
beforeEach(() => jest.resetAllMocks());

it('rejects a website audit before metered requests or cooldown lookups when the website is absent', async () => {
  (db as unknown as jest.Mock).mockReturnValue(query({ id: 'location', website: '  ' }));
  const res: any = { status: jest.fn().mockReturnThis(), json: jest.fn() };
  const next = jest.fn();
  await trigger({ clientId: 'client', body: { locationId: '4417a2d4-4007-458d-a457-12f70d6ee738' } } as any, res, next);
  expect(res.status).toHaveBeenCalledWith(400);
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.objectContaining({ code: 'WEBSITE_REQUIRED' }) }));
  expect(db).toHaveBeenCalledTimes(1);
  expect(submitLighthouseTask).not.toHaveBeenCalled();
  expect(next).not.toHaveBeenCalled();
});

it('reuses a submitted Lighthouse task during score recovery rather than purchasing another', async () => {
  (db as unknown as jest.Mock).mockImplementation((table: string) => query(table === 'locations' ? { website: 'https://example.com' } : []));
  (checkOnPageSeo as jest.Mock).mockResolvedValue({ score: 60, details: ['Title present'] });
  const scores = await computeAuditScores('location', 'Trainer', 'already-submitted');
  expect(scores.dfsLighthouseTaskId).toBe('already-submitted');
  expect(scores.onPageScore).toBe(60);
  expect(submitLighthouseTask).not.toHaveBeenCalled();
});

it('returns the new Lighthouse task ID for the caller to persist even if page checks cannot score', async () => {
  (db as unknown as jest.Mock).mockImplementation((table: string) => query(table === 'locations' ? { website: 'https://example.com' } : []));
  (checkOnPageSeo as jest.Mock).mockResolvedValue({ score: null, details: ['Could not fetch website'] });
  (submitLighthouseTask as jest.Mock).mockResolvedValue('new-task');
  const scores = await computeAuditScores('location', 'Trainer');
  expect(scores.onPageScore).toBeNull();
  expect(scores.dfsLighthouseTaskId).toBe('new-task');
  expect(submitLighthouseTask).toHaveBeenCalledTimes(1);
});
