import { createHash, randomUUID } from 'crypto';
import { z } from 'zod';
import { db } from '../db/connection';
import { campaignRoute } from './campaign_route';
import { withProviderRoute } from './provider_routing';
import { mappingError } from './provider_mapping.service';
import { getClientEMRKey } from './emr_provisioning';
import { sendInvite, EMRInviteError } from './embedmyreviews.service';
export const invitationSchema = z.object({ firstName: z.string().trim().min(1).max(255), lastName: z.string().trim().max(255).optional(), email: z.string().trim().email().max(254).optional(), phone: z.string().regex(/^\+[1-9]\d{6,14}$/, 'Use an international phone number such as +15551234567').optional() }).strict();
type Contact = z.infer<typeof invitationSchema>;
const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
export async function dispatchInvitations(clientId: string, actorId: string, campaignId: string, input: Contact[], requestId: string = randomUUID(), locationId?: string) {
  const contacts = input.map(c => ({ ...c, email: c.email?.toLowerCase() }));
  if (contacts.some(c => !c.email || c.phone)) throw mappingError('Only verified email campaigns are enabled. Provide an email address without a phone number; SMS and WhatsApp need separate channel verification.',422);
  const campaign = await db('emr_campaigns').where({ client_id: clientId, emr_campaign_id: campaignId }).first();
  if (!campaign) throw mappingError('Campaign not found',404);
  const route = await campaignRoute(clientId,campaignId,locationId);
  const key = await getClientEMRKey(clientId); if (!key) throw mappingError('Review connection is not configured',503);
  const payloadHash = hash([campaignId,route.localLocationId,contacts]);
  const batch = await db.transaction(async trx => {
    await trx('campaign_invite_batches').insert({id:randomUUID(),client_id:clientId,request_id:requestId,payload_hash:payloadHash}).onConflict(['client_id','request_id']).ignore();
    const row = await trx('campaign_invite_batches').where({client_id:clientId,request_id:requestId}).first();
    if (row.payload_hash !== payloadHash) throw mappingError('This request ID was already used for different contacts. Start a new request.');
    return row;
  });
  const results = [];
  for (let index=0; index<contacts.length; index++) {
    const contact=contacts[index];
    const emailHash=contact.email?hash([clientId,campaignId,'email',contact.email]):null;
    const phoneHash=contact.phone?hash([clientId,campaignId,'phone',contact.phone]):null;
    const prepared = await withProviderRoute(route, async trx => {
      const previous=await trx('campaign_invitation_attempts').where({batch_id:batch.id,contact_index:index}).first();
      if(previous) return {row:previous,send:false,reused:true};
      const duplicate=await trx('campaign_invitation_attempts').where({client_id:clientId,campaign_id:campaignId}).where(q=>{if(emailHash)q.orWhere({email_hash:emailHash});if(phoneHash)q.orWhere({phone_hash:phoneHash});}).where(q=>q.whereIn('status',['submitting','uncertain']).orWhere(sub=>sub.where({status:'accepted'}).where('created_at','>',new Date(Date.now()-14*86400000)))).first();
      const [row]=await trx('campaign_invitation_attempts').insert({id:randomUUID(),batch_id:batch.id,client_id:clientId,location_id:route.localLocationId,actor_id:actorId,campaign_id:campaignId,campaign_name:campaign.name,contact_index:index,email_hash:emailHash,phone_hash:phoneHash,recipient_hint:[contact.email?contact.email[0]+'***@'+contact.email.split('@')[1]:null,contact.phone?'***'+contact.phone.slice(-4):null].filter(Boolean).join(' / '),status:duplicate?'duplicate_blocked':'submitting',detail:duplicate?'A recent accepted or unresolved request already exists for this recipient. No additional request was sent.':null,provider_route:JSON.stringify(route)}).returning('*');
      return {row,send:!duplicate,reused:false};
    });
    let row=prepared.row;
    if(prepared.send) {
      let attempted=false;
      try {
        await withProviderRoute(route, async trx => {
          // Recheck setup under the same mapping lock immediately before this external write.
          await campaignRoute(clientId,campaignId,route.localLocationId??undefined);
          attempted=true;
          const receipt=await sendInvite(key,campaignId,contact);
          if (!receipt || receipt.httpStatus !== 202) throw new Error('Provider acceptance was not confirmed.');
          [row]=await trx('campaign_invitation_attempts').where({id:row.id}).update({status:'accepted',provider_reference:receipt.providerReference,provider_status:receipt.httpStatus,detail:'Provider accepted the request. Delivery is not confirmed; opt-outs, duplicate rules and send windows may affect processing.',updated_at:new Date()}).returning('*');
        });
      } catch(e) {
        const confirmed=!attempted||(e instanceof EMRInviteError&&e.definite);
        [row]=await db('campaign_invitation_attempts').where({id:row.id}).update({status:confirmed?'rejected':'uncertain',provider_status:e instanceof EMRInviteError?e.httpStatus:null,detail:confirmed?'No accepted request was confirmed. Check campaign setup, permissions, credits and contact details before a deliberate new attempt.':'The outcome is unknown. Do not resend. Ask support to inspect provider activity using the time and request reference.',updated_at:new Date()}).returning('*');
      }
    }
    results.push({id:row.id,index,status:row.status,reused:prepared.reused,detail:row.detail});
  }
  return { requestId, accepted:results.filter(r=>r.status==='accepted').length, uncertain:results.filter(r=>['uncertain','submitting'].includes(r.status)).length, rejected:results.filter(r=>r.status==='rejected').length, duplicateBlocked:results.filter(r=>r.status==='duplicate_blocked').length, deliveryConfirmed:false, results };
}
