import {Request,Response,NextFunction} from 'express';
import {z} from 'zod';
import {db} from '../db/connection';
import {resolveProviderRoute} from '../services/provider_routing';
import {ok,err} from '../utils/response';
export async function status(req:Request,res:Response,next:NextFunction) {
  try {
    const locationId=z.string().uuid().optional().parse(req.query.locationId);
    const locations=await db('locations').where({client_id:req.clientId}).modify(q=>{if(locationId)q.where({id:locationId});});
    if(locationId&&!locations.length){err(res,'Location not found',404);return;}
    const states=[];
    for(const location of locations) {
      let route;
      try {route=await resolveProviderRoute(req.clientId,location.id);} catch {states.push({locationId:location.id,name:location.name,status:'mapping_required',lastSuccessAt:null,sourceCount:null});continue;}
      if(!route){states.push({locationId:location.id,name:location.name,status:'not_connected',lastSuccessAt:null,sourceCount:null});continue;}
      const saved=await db('review_sync_state').where({client_id:req.clientId,provider_location_id:route.providerLocationId}).first();
      const same=saved&&Object.keys(route).every(k=>saved.route[k]===route[k as keyof typeof route]);
      const stored=await db('reviews').where({client_id:req.clientId,source:'emr',emr_provider_location_id:route.providerLocationId}).count('* as n').first();
      const integration=await db('integrations').where({client_id:req.clientId,provider:'embedmyreviews'}).first();
      let state=same?saved.status:'not_checked';
      if(integration?.status!=='connected')state='not_connected';
      else if(state==='running'&&Date.now()-new Date(saved.started_at).getTime()>15*60*1000)state='stalled';
      else if(state==='succeeded'&&Date.now()-new Date(saved.last_success_at).getTime()>24*60*60*1000)state='stale';
      states.push({locationId:location.id,name:location.name,status:state,lastSuccessAt:same?saved.last_success_at:null,sourceCount:same?saved.last_source_count:null,storedCount:Number(stored?.n??0)});
    }
    res.setHeader('Cache-Control','no-store');
    ok(res,{source:'EmbedMyReviews',locations:states});
  }catch(e){next(e);}
}
