import { sendInvite, fetchCampaigns, fetchReviews, readReplyState, replyToReview } from '../../services/embedmyreviews.service';

describe('EMR transport retries', () => {
  const originalFetch = global.fetch;
  afterEach(() => { global.fetch = originalFetch; jest.useRealTimers(); });
  it('does not automatically replay a write when rate limited', async () => {
    global.fetch = jest.fn().mockResolvedValue(new Response('{}', { status: 429, headers: { 'retry-after': '1000' } }));
    await expect(sendInvite('test', 'campaign', { firstName: 'Test', email: 'test@example.invalid' })).rejects.toThrow();
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
  it.each(['{"id":"provider-reference"}', '{}', 'null', 'not-json'])('records 202 acceptance even without a usable receipt: %s', async body => {
    global.fetch = jest.fn().mockResolvedValue(new Response(body, {status:202}));
    await expect(sendInvite('test','campaign',{firstName:'Test',email:'test@example.invalid'})).resolves.toEqual({httpStatus:202,providerReference:body.includes('provider-reference')?'provider-reference':null});
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
  it.each([[401,true],[402,true],[403,true],[422,true],[429,true],[409,false],[500,false],[200,false]])('classifies HTTP %s without retrying', async (status,definite) => {
    global.fetch=jest.fn().mockResolvedValue(new Response('{}',{status:status as number}));
    await expect(sendInvite('test','campaign',{firstName:'Test',email:'test@example.invalid'})).rejects.toMatchObject({httpStatus:status,definite});
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
  it('scopes every campaign page and preserves unknown versus observed zero', async () => {
    global.fetch=jest.fn().mockResolvedValueOnce(new Response(JSON.stringify({data:[{id:'a',name:'A',statistics:{invited:0,opened:-1,clicked:'3'}}],meta:{current_page:1,last_page:2}})))
      .mockResolvedValueOnce(new Response(JSON.stringify({data:[{id:'b',name:'B'}],meta:{current_page:2,last_page:2}})));
    await expect(fetchCampaigns('test',26)).resolves.toMatchObject([{id:'a',invited:0,opened:null,clicked:null},{id:'b',invited:null}]);
    expect((global.fetch as jest.Mock).mock.calls.map(c=>c[0])).toEqual([expect.stringContaining('organization_id=26&page=1'),expect.stringContaining('organization_id=26&page=2')]);
  });
  it('rejects inconsistent campaign pagination', async () => {
    global.fetch=jest.fn().mockResolvedValue(new Response(JSON.stringify({data:[],meta:{current_page:2,last_page:2}})));
    await expect(fetchCampaigns('test',26)).rejects.toThrow('pagination');
  });
  it('requires explicit reply state and retains provider identity on reads', async () => {
    global.fetch = jest.fn().mockResolvedValueOnce(new Response(JSON.stringify({ data: { id: 1, organization_id: 2, location_id: 3, source: 'Google' } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { id: 1, organization_id: 2, location_id: 3, source: 'Google', reply: null, reply_date: null } }), { status: 200 }));
    await expect(readReplyState('test', '1')).rejects.toThrow('incomplete');
    await expect(readReplyState('test', '1')).resolves.toEqual({ id: '1', organizationId: '2', locationId: '3', source: 'Google', reply: null, replyDate: null });
  });
  it('does not mistake accepted publication for confirmed publication', async () => {
    global.fetch = jest.fn().mockResolvedValue(new Response('{}', { status: 202 }));
    await expect(replyToReview('test', '1', 'Approved')).rejects.toThrow('Reconciliation'); expect(global.fetch).toHaveBeenCalledTimes(1);
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
