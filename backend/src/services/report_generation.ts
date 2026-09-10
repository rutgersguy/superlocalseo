import {randomUUID,createHash} from 'crypto';
import {promises as fs} from 'fs';
import path from 'path';
import {db} from '../db/connection';
import {config} from '../config';
import {ReportDeliveryError} from './report_delivery';
import type {ReportData} from './report.service';
type Dependencies={gather:(clientId:string,month:number,year:number)=>Promise<ReportData>;render:(data:ReportData)=>string;pdf:(html:string,file:string)=>Promise<void>;send:(to:string,name:string,period:string,file:string,id:string)=>Promise<string>};
export async function generateReportOnce(clientId:string,month:number,year:number,deps:Dependencies):Promise<string>{
  const now=new Date();
  if(!Number.isInteger(month)||month<1||month>12||!Number.isInteger(year)||year<2020||year>now.getUTCFullYear()||(year===now.getUTCFullYear()&&month>now.getUTCMonth()+1))throw new Error('Invalid report period');
  const generation=randomUUID();
  const claim=await db.transaction(async trx=>{
    await trx('reports').insert({client_id:clientId,period_month:month,period_year:year,status:'pending',email_status:'not_started'}).onConflict(['client_id','period_month','period_year']).ignore();
    const row=await trx('reports').where({client_id:clientId,period_month:month,period_year:year}).forUpdate().first();
    if(row.file_path)return {row,generate:false};
    if(row.status==='generating'&&row.generation_started_at&&Date.now()-new Date(row.generation_started_at).getTime()<15*60000)return {row,generate:false};
    await trx('reports').where({id:row.id}).update({status:'generating',generation_token:generation,generation_started_at:now,updated_at:now});
    return {row,generate:true};
  });
  const id=claim.row.id;
  if(claim.generate){
    try{
      const data=await deps.gather(clientId,month,year);
      const file=path.join(config.reports.dir,clientId,`${year}-${String(month).padStart(2,'0')}-${generation}.pdf`);
      await deps.pdf(deps.render(data),file);
      const digest=createHash('sha256').update(await fs.readFile(file)).digest('hex');
      const updated=await db('reports').where({id,generation_token:generation}).update({status:'generated',file_path:file,generated_at:new Date(),updated_at:new Date(),email_payload:JSON.stringify({to:data.client.email,name:data.client.businessName,period:data.period.label,file,digest})});
      if(!updated)return id; // A newer recovery owns this report; never mail our abandoned file.
    }catch(e){
      await db('reports').where({id,generation_token:generation}).update({status:'failed',updated_at:new Date()});throw e;
    }
  }
  const delivery=await db.transaction(async trx=>{
    const row=await trx('reports').where({id}).forUpdate().first();
    // Durable uncertain/accepted/legacy attempts cannot be replayed, including after
    // the provider's 24-hour idempotency window expires.
    if(!row.file_path||!row.email_payload||!['not_started','rejected'].includes(row.email_status))return null;
    await trx('reports').where({id}).update({email_status:'sending',email_attempted_at:new Date(),updated_at:new Date()});
    return row.email_payload;
  });
  if(!delivery)return id;
  let attempted=false;
  try{
    const digest=createHash('sha256').update(await fs.readFile(delivery.file)).digest('hex');
    if(digest!==delivery.digest)throw new Error('Stored report file changed');
    attempted=true;
    const receipt=await deps.send(delivery.to,delivery.name,delivery.period,delivery.file,id);
    if(!receipt)throw new ReportDeliveryError(false);
    await db('reports').where({id,email_status:'sending'}).update({status:'sent',email_status:'accepted',email_provider_id:receipt,email_recipient:delivery.to,sent_at:new Date(),updated_at:new Date()});
  }catch(e){
    const rejected=!attempted||(e instanceof ReportDeliveryError&&e.definite);
    await db('reports').where({id,email_status:'sending'}).update({email_status:rejected?'rejected':'uncertain',updated_at:new Date()});
    // PDF remains available. A subsequent explicit generation request can retry a
    // confirmed rejection, but never an ambiguous outcome or known acceptance.
  }
  return id;
}
