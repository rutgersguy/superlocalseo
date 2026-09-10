import {promises as fs} from 'fs';
import os from 'os';
import path from 'path';
import {sendReportAttachment} from '../../services/report_delivery';
describe('report email receipts',()=>{
  let dir:string,file:string;const original=global.fetch;
  beforeAll(async()=>{dir=await fs.mkdtemp(path.join(os.tmpdir(),'report-mail-'));file=path.join(dir,'sample.pdf');await fs.writeFile(file,'%PDF fixture');});
  afterEach(()=>{global.fetch=original;});afterAll(async()=>{await fs.rm(dir,{recursive:true,force:true});});
  it('requires a provider receipt and sends an HTTP idempotency key with escaped content',async()=>{
    global.fetch=jest.fn().mockResolvedValue(new Response(JSON.stringify({id:'accepted-id'})));
    await expect(sendReportAttachment('test@example.invalid','<business>','January 2026',file,'report-id')).resolves.toBe('accepted-id');
    const options=(global.fetch as jest.Mock).mock.calls[0][1];expect(options.headers['Idempotency-Key']).toBe('monthly-report/report-id');expect(JSON.parse(options.body).html).toContain('&lt;business&gt;');
  });
  it.each([[422,true],[429,true],[500,false],[409,false]])('classifies HTTP %s without replaying',async(status,definite)=>{
    global.fetch=jest.fn().mockResolvedValue(new Response('{}',{status:status as number}));
    await expect(sendReportAttachment('test@example.invalid','Name','January',file,'report-id')).rejects.toMatchObject({definite});expect(global.fetch).toHaveBeenCalledTimes(1);
  });
  it('does not treat a successful HTTP response without a receipt as a sent email',async()=>{
    global.fetch=jest.fn().mockResolvedValue(new Response('{}'));
    await expect(sendReportAttachment('test@example.invalid','Name','January',file,'report-id')).rejects.toMatchObject({definite:false});
  });
});
