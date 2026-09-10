import { useRef, useState } from 'react';
import { useSWRConfig } from 'swr';
import { apiFetch } from '../services/api';
type Contact={firstName:string;lastName?:string;email:string};
type Outcome={requestId:string;accepted:number;uncertain:number;rejected:number;duplicateBlocked:number};
function useInvitation(campaignId:string,onSent:()=>void) {
  const {mutate}=useSWRConfig(); const pending=useRef<{requestId:string;contacts:Contact[]}|null>(null);
  const [busy,setBusy]=useState(false); const [error,setError]=useState('');const [outcome,setOutcome]=useState<Outcome|null>(null);
  async function send(contacts:Contact[],bulk:boolean) {
    if(busy)return;setBusy(true);setError('');setOutcome(null);pending.current??={requestId:crypto.randomUUID(),contacts};
    try {
      const p=pending.current;
      const result=await apiFetch<{success:boolean;data:Outcome;error?:{code?:string;message?:string}}>(`/campaigns/${campaignId}/invite${bulk?'/bulk':''}`,{method:'POST',body:JSON.stringify(bulk?{requestId:p.requestId,contacts:p.contacts}:{requestId:p.requestId,...p.contacts[0]})});
      if(!result.success){if(result.error?.code==='VALIDATION_ERROR')pending.current=null;throw new Error(result.error?.message||'Request could not be completed. Check request history.');}
      setOutcome(result.data);pending.current=null;onSent();
    }catch(e){setError((e as Error).message||'Unable to confirm the request. Check history before retrying.');}
    finally{setBusy(false);void mutate(key=>typeof key==='string'&&key.startsWith('/campaigns/history'));}
  }
  return {send,busy,error,outcome,locked:busy||!!pending.current,retry:!!pending.current};
}
function Result({outcome,error}:{outcome:Outcome|null;error:string}) {return <>{error&&<p role="alert" className="text-sm text-red-700">{error} Retrying recovers the same request; recorded attempts are not resent.</p>}{outcome&&<div role="status" className="text-sm text-slate-700"><p>Accepted: {outcome.accepted} · Unknown/unresolved: {outcome.uncertain} · Rejected: {outcome.rejected} · Duplicate blocked: {outcome.duplicateBlocked}</p><p>Delivery is not confirmed. See request history for details.</p></div>}</>;}
export function InviteForm({campaignId,onSent}:{campaignId:string;onSent:()=>void}) {
  const [firstName,setFirst]=useState('');const [lastName,setLast]=useState('');const [email,setEmail]=useState('');const s=useInvitation(campaignId,onSent);
  return <form onSubmit={e=>{e.preventDefault();void s.send([{firstName,lastName:lastName||undefined,email}],false);}} className="space-y-3">
    <p className="text-sm text-slate-600">Send through the verified EMR email campaign. SMS and WhatsApp require separate channel verification.</p>
    <fieldset disabled={s.locked} className="grid gap-3 sm:grid-cols-2"><label className="text-sm">First name<input required maxLength={255} value={firstName} onChange={e=>setFirst(e.target.value)} className="block w-full rounded border-slate-300" /></label><label className="text-sm">Last name (optional)<input maxLength={255} value={lastName} onChange={e=>setLast(e.target.value)} className="block w-full rounded border-slate-300" /></label><label className="text-sm sm:col-span-2">Email<input required type="email" maxLength={254} value={email} onChange={e=>setEmail(e.target.value)} className="block w-full rounded border-slate-300" /></label></fieldset>
    <Result outcome={s.outcome} error={s.error}/><button disabled={s.busy} className="rounded-lg bg-brand-500 px-4 py-2 text-sm text-white disabled:opacity-50">{s.busy?'Submitting…':s.retry?'Recover same request':'Send email invite'}</button>
  </form>;
}
function parse(raw:string):Contact[]{
  const lines=raw.trim().split(/\r?\n/);if(lines.length<2)throw new Error('Include a header and at least one contact.');
  const cells=(line:string)=>{const result:string[]=[];let cell='',quoted=false;for(let i=0;i<line.length;i++){const ch=line[i];if(ch==='"'){if(quoted&&line[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;}else if(ch===','&&!quoted){result.push(cell.trim());cell='';}else cell+=ch;}if(quoted)throw new Error('Quoted multiline cells are not supported. Put each contact on one line.');return [...result,cell.trim()];};
  const headers=cells(lines[0]).map(h=>h.toLowerCase().replace(/\s+/g,'_'));
  if(!headers.includes('first_name')||!headers.includes('email')||new Set(headers).size!==headers.length)throw new Error('Use distinct first_name,last_name,email column headers.');
  const rows=lines.slice(1).filter(l=>l.trim());if(rows.length>50)throw new Error('Submit no more than 50 contacts at a time.');
  return rows.map((line,i)=>{const values=cells(line);if(values.length!==headers.length)throw new Error(`Row ${i+2} has the wrong number of columns.`);const row=Object.fromEntries(headers.map((h,n)=>[h,values[n]]));if(!row.first_name||!row.email||row.phone||row.mobile)throw new Error(`Row ${i+2} needs first_name and email, with no phone number.`);return {firstName:row.first_name,lastName:row.last_name||undefined,email:row.email};});
}
export function BulkUpload({campaignId,onSent}:{campaignId:string;onSent:()=>void}) {
  const [csv,setCsv]=useState('');const [parseError,setError]=useState('');const s=useInvitation(campaignId,onSent);
  const send=()=>{try{const contacts=parse(csv);if(!contacts.length)throw new Error('Add at least one contact.');setError('');void s.send(contacts,true);}catch(e){setError((e as Error).message);}};
  return <div className="space-y-3"><p className="text-sm text-slate-600">Up to 50 email contacts per request. EMR handles delivery. Every row must be valid before anything is submitted.</p><label className="block text-sm">Upload CSV<input disabled={s.locked} type="file" accept=".csv,text/csv" className="block" onChange={e=>{const file=e.target.files?.[0];if(file){if(file.size>50000){setError('CSV must be under 50 KB.');return;}void file.text().then(setCsv);}}}/></label><label className="block text-sm">Contacts CSV<textarea disabled={s.locked} value={csv} maxLength={50000} onChange={e=>setCsv(e.target.value)} rows={5} placeholder={'first_name,last_name,email\nJane,Smith,jane@example.com'} className="block w-full rounded border-slate-300 font-mono"/></label>{parseError&&<p role="alert" className="text-sm text-red-700">{parseError}</p>}<Result outcome={s.outcome} error={s.error}/><button disabled={s.busy||!csv.trim()} onClick={send} className="rounded-lg bg-brand-500 px-4 py-2 text-sm text-white disabled:opacity-50">{s.busy?'Submitting…':s.retry?'Recover same request':'Submit email invitations'}</button></div>;
}
