import request from 'supertest';
import app from '../app';
import { db } from '../db/connection';
import { processProspectReport, PROSPECT_SOURCE } from '../services/prospect_report.service';
import { prospectReportsQueue } from '../jobs/queue';
import { prospectCreateSchema } from '../routes/prospect_reports';
jest.mock('../jobs/queue', () => ({ prospectReportsQueue: { add: jest.fn().mockResolvedValue({id:'fixture'}) } }));
jest.mock('../config', () => ({ config: { ...jest.requireActual('../config').config, dataforseo: { login: 'fixture', password: 'fixture' } } }));
const body={placeId:'selected-fixture',areaId:'1304000',keyword:'film production',email:`native-report-${Date.now()}@example.test`,consent:true};
const ids:string[]=[];
const provider=(items:any[])=>({status_code:20000,tasks:[{status_code:20000,result:[{datetime:'2026-09-09 12:00:00 +00:00',items,items_count:items.length}]}]});
describe('native report API and delivery',()=>{
afterAll(async()=>{if(ids.length) await db('audit_leads').whereIn('id',ids).delete();});
it('requires report-only consent and rejects bot fields',()=>{expect(prospectCreateSchema.safeParse({...body,consent:false}).success).toBe(false);expect(prospectCreateSchema.safeParse({...body,website:'spam'}).success).toBe(false);});
it('queues an anonymous report, caps the recipient, and never exposes their email',async()=>{
  for(let i=0;i<2;i++){const r=await request(app).post('/api/free-reports').send(body);expect(r.status).toBe(202);ids.push(r.body.data.id);}
  expect((await request(app).post('/api/free-reports').send(body)).status).toBe(429);
  expect(prospectReportsQueue.add).toHaveBeenCalledWith('generate',{id:ids[0]},expect.objectContaining({jobId:ids[0],attempts:3}));
  const r=await request(app).get(`/api/free-reports/${ids[0]}`);expect(r.status).toBe(200);expect(r.body.data.status).toBe('queued');expect(JSON.stringify(r.body)).not.toContain(body.email);expect(JSON.stringify(r.body)).not.toContain('consentAt');
});
it('persists an immutable snapshot before email and retries delivery without rescanning',async()=>{
  let scans=0;let mails=0;const payloads:any[]=[];
  const mock=jest.spyOn(global,'fetch').mockImplementation(async(url,init)=>{
    if(String(url).includes('resend.com')){mails++;payloads.push(JSON.parse(String(init?.body)));return {ok:mails>1,json:async()=>({id:'mail'})} as Response;}
    scans++;return {ok:true,json:async()=>String(url).includes('my_business_info') ? provider([{type:'google_business_info',place_id:body.placeId,title:'Verified <Business>',address:null,rating:{value:5,votes_count:8}}]) : provider([{type:'maps_search',rank_group:1,place_id:body.placeId,title:'Verified Business'}])} as Response;
  });
  try{
    await expect(processProspectReport(ids[0])).rejects.toThrow('email');
    const before=(await db('audit_leads').where({id:ids[0]}).first()).audit_data.snapshot;
    expect(before.summary).toMatchObject({found:9,checked:9,averageWhenFound:1});expect(scans).toBe(10);
    await processProspectReport(ids[0]);expect(scans).toBe(10);expect(mails).toBe(2);
    const after=(await request(app).get(`/api/free-reports/${ids[0]}`)).body.data;
    expect(after.snapshot).toEqual(before);expect(after.emailStatus).toBe('accepted');expect(payloads[0].html).toContain('Verified &lt;Business&gt;');expect(payloads[0]).toEqual(payloads[1]);
    await processProspectReport(ids[0]);expect(mails).toBe(2);
  }finally{mock.mockRestore();}
});
it('rejects invalid identifiers and does not expose another lead source',async()=>{
  expect((await request(app).get('/api/free-reports/not-a-uuid')).status).toBe(404);
  await db('audit_leads').where({id:ids[1]}).update({source:'other-fixture'});
  expect((await request(app).get(`/api/free-reports/${ids[1]}`)).status).toBe(404);
  await db('audit_leads').where({id:ids[1]}).update({source:PROSPECT_SOURCE});
});

it('enforces the global cap before enqueueing more provider spend',async()=>{
  const inserted=await db('audit_leads').insert(Array.from({length:50},()=>({business_name:'Cap fixture',city:'Atlanta city, GA',source:PROSPECT_SOURCE,audit_data:'{}'}))).returning('id');
  const capIds=inserted.map(r=>r.id);ids.push(...capIds);const before=(prospectReportsQueue.add as jest.Mock).mock.calls.length;
  const r=await request(app).post('/api/free-reports').set('X-Forwarded-For','198.51.100.2').send({...body,email:'different-cap@example.test'});
  expect(r.status).toBe(429);expect(r.body.error.code).toBe('RATE_LIMITED');expect((prospectReportsQueue.add as jest.Mock).mock.calls.length).toBe(before);
  await db('audit_leads').whereIn('id',capIds).delete();
});
it('returns a safe failed status when enqueueing is unavailable',async()=>{
  (prospectReportsQueue.add as jest.Mock).mockRejectedValueOnce(new Error('private-provider-detail'));
  const r=await request(app).post('/api/free-reports').set('X-Forwarded-For','198.51.100.3').send({...body,email:'queue-failure@example.test'});expect(r.status).toBe(202);ids.push(r.body.data.id);
  const state=await request(app).get(`/api/free-reports/${r.body.data.id}`);expect(state.body.data.status).toBe('failed');expect(JSON.stringify(state.body)).not.toContain('private-provider-detail');
});

});
