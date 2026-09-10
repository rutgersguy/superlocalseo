import {promises as fs} from 'fs';
import {config} from '../config';
const escape=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export class ReportDeliveryError extends Error {
  constructor(public definite:boolean){super(definite?'Report email was rejected.':'Report email outcome is unknown.');}
}
export async function sendReportAttachment(to:string,businessName:string,period:string,pdfPath:string,reportId:string):Promise<string>{
  const content=(await fs.readFile(pdfPath)).toString('base64');
  const response=await fetch('https://api.resend.com/emails',{
    method:'POST',signal:AbortSignal.timeout(15000),
    headers:{Authorization:`Bearer ${config.resend.apiKey}`,'Content-Type':'application/json','Idempotency-Key':`monthly-report/${reportId}`},
    body:JSON.stringify({from:`${config.resend.fromName} <${config.resend.fromEmail}>`,to,
      subject:`Your ${period} SEO Report — ${businessName}`,
      html:`<p>Your <strong>${escape(period)}</strong> report for <strong>${escape(businessName)}</strong> is ready.</p><p>The attached PDF summarizes the data available for your selected plan. Reply to this email if you have questions.</p>`,
      attachments:[{filename:`SEO-Report-${period.replace(/[^a-zA-Z0-9 -]/g,'')}.pdf`,content}],
    }),
  });
  if(!response.ok)throw new ReportDeliveryError([400,401,403,404,405,422,429].includes(response.status));
  const body=await response.json() as {id?:unknown};
  if(typeof body?.id!=='string'||!body.id||body.id.length>255)throw new ReportDeliveryError(false);
  return body.id;
}
