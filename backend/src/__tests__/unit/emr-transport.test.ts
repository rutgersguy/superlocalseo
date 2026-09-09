import { sendInvite, fetchReviews } from '../../services/embedmyreviews.service';

describe('EMR transport retries', () => {
  const originalFetch = global.fetch;
  afterEach(() => { global.fetch = originalFetch; jest.useRealTimers(); });
  it('does not automatically replay a write when rate limited', async () => {
    global.fetch = jest.fn().mockResolvedValue(new Response('{}', { status: 429, headers: { 'retry-after': '1000' } }));
    await expect(sendInvite('test', 'campaign', { firstName: 'Test', email: 'test@example.invalid' })).rejects.toThrow();
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
  it('bounds excessive retry delays on reads', async () => {
    jest.useFakeTimers();
    global.fetch = jest.fn()
      .mockResolvedValueOnce(new Response('{}', { status: 429, headers: { 'retry-after': '100000' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [], meta: { current_page: 1, last_page: 1 } }), { status: 200 }));
    const pending = fetchReviews('test', { locationId: '33' });
    await jest.advanceTimersByTimeAsync(30000);
    await expect(pending).resolves.toMatchObject({ reviews: [], hasMore: false });
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect((global.fetch as jest.Mock).mock.calls[0][1].signal).toBeDefined();
  });
});
