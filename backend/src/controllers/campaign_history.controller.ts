import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { db } from '../db/connection';
import { ok } from '../utils/response';
async function history(req: Request, res: Response, next: NextFunction, admin: boolean) {
  try {
    const q=z.object({page:z.coerce.number().int().min(1).max(100000).default(1),status:z.enum(['submitting','accepted','uncertain','rejected','duplicate_blocked']).optional()}).parse(req.query);
    const query=db('campaign_invitation_attempts as a').leftJoin('locations as l','l.id','a.location_id').leftJoin('clients as c','c.id','a.client_id');
    if(!admin)query.where('a.client_id',req.clientId);
    if(q.status)query.where('a.status',q.status);
    const total=Number((await query.clone().count('a.id as n').first())?.n??0);
    const rows=await query.clone().select('a.*','l.name as location_name','c.business_name').orderBy('a.created_at','desc').orderBy('a.id','desc').limit(25).offset((q.page-1)*25);
    res.setHeader('Cache-Control','no-store');
    ok(res,{total,page:q.page,pages:Math.ceil(total/25),attempts:rows.map(r=>({id:r.id,campaignName:r.campaign_name,locationName:r.location_name??'Retired location',businessName:admin?r.business_name:undefined,recipient:r.recipient_hint,status:r.status,detail:r.detail,providerReference:admin?r.provider_reference:undefined,providerStatus:admin?r.provider_status:undefined,createdAt:r.created_at,updatedAt:r.updated_at})),deliveryTrackingAvailable:false});
  } catch(e){next(e);}
}
export const clientHistory=(req:Request,res:Response,next:NextFunction)=>history(req,res,next,false);
export const adminHistory=(req:Request,res:Response,next:NextFunction)=>history(req,res,next,true);
