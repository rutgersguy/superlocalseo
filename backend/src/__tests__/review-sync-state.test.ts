import request from 'supertest';
import app from '../app';
import {db} from '../db/connection';
import {encrypt} from '../utils/crypto';
import {processReviews} from '../jobs/reviews.job';
import {fetchAllReviews} from '../services/embedmyreviews.service';
import {reviewsQueue} from '../jobs/queue';
import {handleEmrWebhook} from '../controllers/emr_webhook.controller';
jest.mock('../services/embedmyreviews.service',()=>({...jest.requireActual('../services/embedmyreviews.service'),fetchAllReviews:jest.fn(),fetchCampaigns:jest.fn().mockResolvedValue([])}));
const review=(body='Current',date='2026-01-01T00:00:00Z')=>({id:'sync-test',platform:'Google',author:'Fixture',rating:5,body,date,url:null,replied:false,replyDate:null,replyText:null,hidden:false,avatarUrl:null,verified:null});
describe('review synchronization reliability',()=>{
  let clientId:string,locationId:string,token:string;const email=`sync-state-${Date.now()}@example.com`;
  const run=()=>processReviews({data:{clientId,emrOnly:true}} as any);
  const status=()=>request(app).get('/api/reviews/sync-status').set('Authorization',`Bearer ${token}`);
  beforeAll(async()=>{
    await request(app).post('/api/auth/register').send({email,password:'Password123!',businessName:'Sync fixture'});
    const user=await db('users').where({email}).first();clientId=(await db('clients').where({user_id:user.id}).first()).id;
    token=(await request(app).post('/api/auth/login').send({email,password:'Password123!'})).body.data.accessToken;
    await db('clients').where({id:clientId}).update({emr_organization_id:887700,emr_location_id:887701});
    locationId=(await db('locations').insert({client_id:clientId,name:'Sync fixture'}).returning('id'))[0].id;
    await db('integrations').where({client_id:clientId,provider:'embedmyreviews'}).delete();
    await db('integrations').insert({client_id:clientId,provider:'embedmyreviews',status:'connected',api_key_encrypted:encrypt('fixture')});
    jest.spyOn(reviewsQueue,'add').mockResolvedValue({} as never);
  });
  afterAll(async()=>{await db('users').where({email}).delete();});
  beforeEach(()=>{jest.clearAllMocks();(fetchAllReviews as jest.Mock).mockResolvedValue([review()]);});
  it('distinguishes unknown, successful, failed and empty snapshots while preserving saved reviews',async()=>{
    expect((await status()).body.data.locations[0]).toMatchObject({status:'not_checked',sourceCount:null});
    await run();expect((await status()).body.data.locations[0]).toMatchObject({status:'succeeded',sourceCount:1,storedCount:1});
    (fetchAllReviews as jest.Mock).mockRejectedValueOnce(new Error('Secret-bearing upstream failure'));
    await run();const failed=await status();expect(failed.body.data.locations[0]).toMatchObject({status:'failed',sourceCount:1,storedCount:1});expect(JSON.stringify(failed.body)).not.toContain('Secret-bearing');
    (fetchAllReviews as jest.Mock).mockResolvedValueOnce([]);await run();expect((await status()).body.data.locations[0]).toMatchObject({status:'succeeded',sourceCount:0,storedCount:1});
  });
  it('does not let an older overlapping snapshot overwrite a newer one',async()=>{
    let release!:(v:any)=>void,started!:()=>void;const ready=new Promise<void>(r=>started=r);
    (fetchAllReviews as jest.Mock).mockImplementationOnce(()=>{started();return new Promise(r=>release=r);}).mockResolvedValueOnce([review('Newer','2025-12-01T00:00:00Z')]);
    const old=run();await ready;await run();release([review('Older')]);await old;
    const saved=await db('reviews').where({client_id:clientId}).first();expect(saved.body).toBe('Newer');expect(new Date(saved.review_date).toISOString()).toBe('2025-12-01T00:00:00.000Z');
  });
  it('retains reply publication that completed while an import was in flight',async()=>{
    const saved=await db('reviews').where({client_id:clientId}).first();
    (fetchAllReviews as jest.Mock).mockImplementationOnce(async()=>{
      await db('reviews').where({id:saved.id}).update({replied:true,emr_reply_text:'Approved reply'});
      await db('review_responses').insert({client_id:clientId,review_id:saved.id,final_body:'Approved reply',status:'posted',updated_at:new Date(Date.now()+1000)});
      return [review()];
    });
    await run();expect((await db('reviews').where({id:saved.id}).first()).emr_reply_text).toBe('Approved reply');
  });
  it('rejects foreign locations and exposes stale or stalled imports without hiding reviews',async()=>{
    expect((await request(app).get('/api/reviews/sync-status?locationId=00000000-0000-4000-8000-000000000000').set('Authorization',`Bearer ${token}`)).status).toBe(404);
    await db('review_sync_state').where({client_id:clientId}).update({status:'succeeded',last_success_at:new Date(Date.now()-25*3600000)});
    expect((await status()).body.data.locations[0].status).toBe('stale');
    await db('review_sync_state').where({client_id:clientId}).update({status:'running',started_at:new Date(Date.now()-16*60000)});
    expect((await status()).body.data.locations[0].status).toBe('stalled');
  });
  it('legacy webhook notifications enqueue reads without overwriting reviews; queue failures are retryable',async()=>{
    const payload={webhook_event:'review-updated',organization_id:887700,location_id:887701,data:{id:'sync-test',source:'Google',rating:1,message:'Delayed stale payload'}};
    const res:any={json:jest.fn(),status:jest.fn().mockReturnThis()};
    const before=await db('reviews').where({client_id:clientId}).first();
    await handleEmrWebhook({body:payload} as any,res);
    expect(reviewsQueue.add).toHaveBeenCalledWith('provider-webhook-import',expect.objectContaining({clientId,locationId,emrOnly:true}),expect.anything());
    expect((await db('reviews').where({id:before.id}).first()).body).toBe(before.body);
    expect(res.json).toHaveBeenCalledWith({received:true});
    (reviewsQueue.add as jest.Mock).mockRejectedValueOnce(new Error('Redis unavailable'));
    await handleEmrWebhook({body:payload} as any,res);expect(res.status).toHaveBeenCalledWith(503);
  });
});
