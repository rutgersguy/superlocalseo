import request from 'supertest';
import { randomUUID } from 'crypto';
import app from '../app';
import { db } from '../db/connection';
import { verificationBinding } from '../services/campaign_verification';
import { sendInvite, EMRInviteError } from '../services/embedmyreviews.service';
jest.mock('../services/embedmyreviews.service',()=>({...jest.requireActual('../services/embedmyreviews.service'),sendInvite:jest.fn()}));
jest.mock('../services/emr_provisioning',()=>({getClientEMRKey:jest.fn().mockResolvedValue('fixture')}));
describe('Durable campaign invitations',()=>{
  let token:string,other:string,admin:string,clientId:string,locationId:string;
  const emails:string[]=[];const campaignId='invitation-fixture-'+Date.now();
  const call=(body:object,bearer=token,bulk=false)=>request(app).post(`/api/campaigns/${campaignId}/invite${bulk?'/bulk':''}`).set('Authorization',`Bearer ${bearer}`).send(body);
  beforeAll(async()=>{
    for(const label of ['owner','other','admin']){
      const email=`invitation-${label}-${Date.now()}@example.com`;emails.push(email);
      await request(app).post('/api/auth/register').send({email,password:'Password123!',businessName:'Invitation fixture'});
      const user=await db('users').where({email}).first();if(label==='admin')await db('users').where({id:user.id}).update({role:'admin'});
      const auth=(await request(app).post('/api/auth/login').send({email,password:'Password123!'})).body.data.accessToken;
      if(label==='owner'){token=auth;clientId=(await db('clients').where({user_id:user.id}).first()).id;}else if(label==='other')other=auth;else admin=auth;
    }
    await db('clients').where({id:clientId}).update({emr_organization_id:884400,emr_location_id:884401});
    const [l]=await db('locations').insert({client_id:clientId,name:'Verified invitation branch',google_place_id:'ChIJ-invitation'}).returning('*');locationId=l.id;
    const [c]=await db('emr_campaigns').insert({client_id:clientId,emr_campaign_id:campaignId,name:'Verified email campaign',metrics_pulled_at:new Date()}).returning('*');
    const client=await db('clients').where({id:clientId}).first();
    await db('campaign_setup_requests').insert({client_id:clientId,location_id:locationId,status:'verified',verification:JSON.stringify({campaignId,templateVersion:'honest-email-v1',binding:verificationBinding(l,client,c),verifiedAt:new Date().toISOString()})});
  });
  afterAll(async()=>{await db('users').whereIn('email',emails).delete();});
  beforeEach(()=>{jest.clearAllMocks();(sendInvite as jest.Mock).mockResolvedValue({providerReference:'provider-fixture',httpStatus:202});});
  it('persists before sending and deduplicates concurrent request retries',async()=>{
    const body={requestId:randomUUID(),firstName:'Fixture',email:'first@example.com'};
    (sendInvite as jest.Mock).mockImplementation(async()=>{expect((await db('campaign_invitation_attempts').where({client_id:clientId}).first()).status).toBe('submitting');return {providerReference:'provider-fixture',httpStatus:202};});
    const r=await Promise.all([call(body),call(body)]);r.forEach(r=>expect(r.status).toBe(200));expect(sendInvite).toHaveBeenCalledTimes(1);
    expect((await call(body)).body.data.accepted).toBe(1);expect(sendInvite).toHaveBeenCalledTimes(1);
    expect((await call({...body,email:'different@example.com'})).status).toBe(409);
  });
  it('blocks duplicate recipients across new request IDs, case changes and duplicate CSV rows',async()=>{
    const contact={firstName:'Fixture',email:'FIRST@example.com'};
    expect((await call({...contact,requestId:randomUUID()})).body.data.duplicateBlocked).toBe(1);expect(sendInvite).not.toHaveBeenCalled();
    const r=await call({requestId:randomUUID(),contacts:[{firstName:'New',email:'new@example.com'},{firstName:'New again',email:'new@example.com'}]},token,true);
    expect(r.body.data).toMatchObject({accepted:1,duplicateBlocked:1,deliveryConfirmed:false});expect(sendInvite).toHaveBeenCalledTimes(1);
  });
  it('retains unknown outcomes indefinitely without resending or calling them failures',async()=>{
    (sendInvite as jest.Mock).mockRejectedValue(new Error('Response timeout'));
    const body={requestId:randomUUID(),firstName:'Timeout',email:'timeout@example.com'};
    expect((await call(body)).body.data).toMatchObject({accepted:0,uncertain:1,rejected:0});
    await db('campaign_invitation_attempts').where({client_id:clientId,status:'uncertain'}).update({created_at:new Date('2020-01-01')});
    expect((await call({...body,requestId:randomUUID()})).body.data.duplicateBlocked).toBe(1);expect(sendInvite).toHaveBeenCalledTimes(1);
  });
  it('records a known rejection and allows only a deliberate new request to retry it',async()=>{
    (sendInvite as jest.Mock).mockRejectedValueOnce(new EMRInviteError(429));
    const body={requestId:randomUUID(),firstName:'Rate limited',email:'limited@example.com'};
    expect((await call(body)).body.data.rejected).toBe(1);
    expect((await call(body)).body.data.rejected).toBe(1);expect(sendInvite).toHaveBeenCalledTimes(1);
    expect((await call({...body,requestId:randomUUID()})).body.data.accepted).toBe(1);expect(sendInvite).toHaveBeenCalledTimes(2);
  });
  it('validates all rows before sending and rejects foreign or unverified channels',async()=>{
    expect((await call({firstName:'Foreign',email:'a@example.com'},other)).status).toBe(404);
    expect((await call({firstName:'Phone',phone:'+15551234567'})).status).toBe(422);
    expect((await call({contacts:[{firstName:'Valid',email:'valid@example.com'},{firstName:'Invalid',email:'bad'}]},token,true)).status).toBe(422);
    expect((await call({contacts:Array.from({length:51},()=>({firstName:'Fixture',email:'a@example.com'}))},token,true)).status).toBe(422);
    expect(sendInvite).not.toHaveBeenCalled();
  });
  it('isolates history and exposes operator references only to administrators',async()=>{
    const own=await request(app).get('/api/campaigns/history').set('Authorization',`Bearer ${token}`);expect(own.body.data.total).toBeGreaterThan(0);expect(own.body.data.attempts[0].providerReference).toBeUndefined();
    const foreign=await request(app).get('/api/campaigns/history').set('Authorization',`Bearer ${other}`);expect(foreign.body.data.total).toBe(0);
    expect((await request(app).get('/api/admin/campaign-invitations').set('Authorization',`Bearer ${token}`)).status).toBe(403);
    const queue=await request(app).get('/api/admin/campaign-invitations?status=accepted').set('Authorization',`Bearer ${admin}`);expect(queue.status).toBe(200);expect(queue.body.data.attempts.find((a:any)=>a.campaignName==='Verified email campaign').providerReference).toBe('provider-fixture');
    const campaigns=await request(app).get('/api/campaigns').set('Authorization',`Bearer ${token}`);expect(campaigns.body.data.campaigns[0].invited).toBeNull();expect(campaigns.body.data.campaigns[0].reviewed).toBeNull();
  });
});
