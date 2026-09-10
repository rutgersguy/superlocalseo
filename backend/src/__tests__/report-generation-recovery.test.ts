import request from 'supertest';
import {promises as fs} from 'fs';
import path from 'path';
import os from 'os';
import app from '../app';
import {db} from '../db/connection';
import {config} from '../config';
import {reportsQueue} from '../jobs/queue';
import {generateReportOnce} from '../services/report_generation';
import {ReportDeliveryError} from '../services/report_delivery';
describe('monthly report generation and delivery recovery',()=>{
  const email=`report-recovery-${Date.now()}@example.com`;let clientId:string,token:string,dir:string;const originalDir=config.reports.dir;
  const deps={gather:jest.fn(),render:jest.fn().mockReturnValue('<p>Report fixture</p>'),pdf:jest.fn(),send:jest.fn()};
  beforeAll(async()=>{
    dir=await fs.mkdtemp(path.join(os.tmpdir(),'sls-report-test-'));Object.assign(config.reports,{dir});
    await request(app).post('/api/auth/register').send({email,password:'Password123!',businessName:'Report fixture'});
    const user=await db('users').where({email}).first();clientId=(await db('clients').where({user_id:user.id}).first()).id;
    token=(await request(app).post('/api/auth/login').send({email,password:'Password123!'})).body.data.accessToken;
    jest.spyOn(reportsQueue,'add').mockResolvedValue({id:'fixture'} as never);
  });
  beforeEach(()=>{
    jest.clearAllMocks();deps.gather.mockResolvedValue({client:{email,businessName:'Fixture'},period:{label:'January 2026'}});
    deps.pdf.mockImplementation(async(_html,file)=>{await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,'%PDF-1.4 fixture');});deps.send.mockResolvedValue('provider-id');
  });
  afterAll(async()=>{Object.assign(config.reports,{dir:originalDir});await db('users').where({email}).delete();await fs.rm(dir,{recursive:true,force:true});});
  const run=(month:number)=>generateReportOnce(clientId,month,2026,deps);
  it('rejects foreign customer IDs and invalid periods before queueing',async()=>{
    const post=(body:object)=>request(app).post('/api/reports/generate').set('Authorization',`Bearer ${token}`).send(body);
    expect((await post({clientId:'00000000-0000-4000-8000-000000000000',month:1,year:2026})).status).toBe(404);
    for(const month of ['1',1.5,0,13])expect((await post({month,year:2026})).status).toBe(422);
    const now=new Date();expect((await post({month:now.getUTCMonth()+1,year:now.getUTCFullYear()})).status).toBe(422);
    expect(reportsQueue.add).not.toHaveBeenCalled();
    expect((await post({month:1,year:2026})).status).toBe(200);
    expect(reportsQueue.add).toHaveBeenCalledWith('generate-report',{clientId,month:1,year:2026});
  });
  it('concurrent requests and subsequent retries generate and submit only once',async()=>{
    const ids=await Promise.all([run(1),run(1)]);await run(1);
    expect(ids[0]).toBe(ids[1]);expect(deps.pdf).toHaveBeenCalledTimes(1);expect(deps.send).toHaveBeenCalledTimes(1);
    const row=await db('reports').where({id:ids[0]}).first();expect(row).toMatchObject({status:'sent',email_status:'accepted',email_provider_id:'provider-id'});
  });
  it('retains PDFs after ambiguous email failure and never resends even after 24 hours',async()=>{
    deps.send.mockRejectedValueOnce(new Error('timeout'));const id=await run(2);const row=await db('reports').where({id}).first();
    expect(row.status).toBe('generated');expect(row.email_status).toBe('uncertain');expect(row.sent_at).toBeNull();await fs.access(row.file_path);
    await db('reports').where({id}).update({email_attempted_at:new Date('2020-01-01')});await run(2);
    expect(deps.pdf).toHaveBeenCalledTimes(1);expect(deps.send).toHaveBeenCalledTimes(1);
    const result=await request(app).get('/api/reports').set('Authorization',`Bearer ${token}`);const exposed=result.body.data.find((r:any)=>r.id===id);
    expect(exposed).toMatchObject({available:true,emailStatus:'uncertain'});expect(exposed.filePath).toBeUndefined();
  });
  it('retries a confirmed rejection using the saved PDF and original recipient',async()=>{
    deps.send.mockRejectedValueOnce(new ReportDeliveryError(true));const id=await run(3);
    deps.gather.mockResolvedValue({client:{email:'changed@example.invalid',businessName:'Changed'},period:{label:'Changed'}});
    await run(3);expect(deps.pdf).toHaveBeenCalledTimes(1);expect(deps.send).toHaveBeenCalledTimes(2);expect(deps.send.mock.calls[1]).toEqual(deps.send.mock.calls[0]);
    expect((await db('reports').where({id}).first()).email_status).toBe('accepted');
  });
  it('does not infer delivery or resend legacy records',async()=>{
    const file=path.join(dir,'legacy.pdf');await fs.writeFile(file,'%PDF-1.4 legacy');
    await db('reports').insert({client_id:clientId,period_month:4,period_year:2026,status:'sent',file_path:file});await run(4);
    expect(deps.pdf).not.toHaveBeenCalled();expect(deps.send).not.toHaveBeenCalled();
  });
  it('recovers abandoned generation without letting its late result send',async()=>{
    let release!:()=>void,started!:()=>void;const ready=new Promise<void>(r=>started=r);
    deps.gather.mockImplementationOnce(async()=>{started();await new Promise<void>(r=>release=r);return {client:{email,businessName:'Old'},period:{label:'Old'}};});
    const old=run(5);await ready;await db('reports').where({client_id:clientId,period_month:5}).update({generation_started_at:new Date('2020-01-01')});
    await run(5);release();await old;expect(deps.send).toHaveBeenCalledTimes(1);expect(deps.send.mock.calls[0][1]).toBe('Fixture');
  });
});
