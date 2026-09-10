import { randomUUID } from 'crypto';
import type { Knex } from 'knex';
import { db } from '../db/connection';
import { ProviderRoute, withProviderRoute } from './provider_routing';
const key = (route: ProviderRoute) => ({client_id:route.clientId,provider_location_id:route.providerLocationId});
export async function startReviewSync(route: ProviderRoute) {
  const generation=randomUUID();
  const startedAt=new Date();
  await withProviderRoute(route,async trx=>{
    const previous=await trx('review_sync_state').where(key(route)).first();
    const changed=previous&&Object.keys(route).some(k=>previous.route[k]!==route[k as keyof ProviderRoute]);
    await trx('review_sync_state').insert({...key(route),generation,route:JSON.stringify(route),started_at:startedAt,status:'running'})
      .onConflict(['client_id','provider_location_id']).merge({generation,route:JSON.stringify(route),started_at:startedAt,completed_at:null,status:'running',...(changed?{last_success_at:null,last_source_count:null}:{})});
  });
  return {generation,startedAt};
}
export async function currentReviewSync(trx:Knex.Transaction,route:ProviderRoute,generation:string) {
  return !!await trx('review_sync_state').where({...key(route),generation}).forUpdate().first();
}
export async function completeReviewSync(trx:Knex.Transaction,route:ProviderRoute,generation:string,count:number) {
  await trx('review_sync_state').where({...key(route),generation}).update({status:'succeeded',completed_at:new Date(),last_success_at:new Date(),last_source_count:count});
}
export async function failReviewSync(route:ProviderRoute,generation:string) {
  return db('review_sync_state').where({...key(route),generation}).update({status:'failed',completed_at:new Date()});
}
