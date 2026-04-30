import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { db } from '../db/connection';
import { ok } from '../utils/response';

export const patchSchema = z.object({
  businessName: z.string().min(2).max(255).optional(),
  industry: z.string().optional(),
  onboardingStep: z.number().int().min(0).max(4).optional(),
});

type PatchBody = z.infer<typeof patchSchema>;

function formatClient(client: Record<string, unknown>, locations: Record<string, unknown>[]) {
  return {
    id: client.id,
    businessName: client.business_name,
    industry: client.industry,
    subscriptionTier: client.subscription_tier,
    subscriptionStatus: client.subscription_status,
    onboardingStep: client.onboarding_step,
    locations: locations.map((l) => ({
      id: l.id,
      name: l.name,
      address: l.address,
      city: l.city,
      state: l.state,
      zip: l.zip,
      phone: l.phone,
      website: l.website,
      isPrimary: l.is_primary,
    })),
  };
}

export async function getClient(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const locations = await db('locations').where({ client_id: req.clientId }).orderBy('is_primary', 'desc').orderBy('created_at', 'asc');
    ok(res, formatClient(req.client, locations));
  } catch (e) {
    next(e);
  }
}

export async function updateClient(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body as PatchBody;
    const updates: Record<string, unknown> = { updated_at: new Date() };

    if (body.businessName !== undefined) updates.business_name = body.businessName;
    if (body.industry !== undefined) updates.industry = body.industry;
    if (body.onboardingStep !== undefined) updates.onboarding_step = body.onboardingStep;

    const [updated] = await db('clients').where({ id: req.clientId }).update(updates).returning('*');

    const locations = await db('locations').where({ client_id: req.clientId }).orderBy('is_primary', 'desc').orderBy('created_at', 'asc');
    ok(res, formatClient(updated as Record<string, unknown>, locations));
  } catch (e) {
    next(e);
  }
}
