import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { db } from '../db/connection';
import { ok } from '../utils/response';
import { provisionClient } from '../services/emr_provisioning';
import { decrypt } from '../utils/crypto';
import { citationsQueue, rankingsQueue } from '../jobs/queue';
import { logger } from '../utils/logger';

export const patchSchema = z.object({
  businessName: z.string()
    .min(2, 'Business name must be at least 2 characters')
    .max(255, 'Business name is too long (max 255 characters)')
    .optional(),
  industry: z.string().optional(),
  onboardingStep: z.number().int().min(0).max(4).optional(),
  whiteLabelCompanyName: z.string().max(255).nullable().optional(),
  whiteLabelLogoUrl: z.string()
    .url('Enter a full URL including https:// (e.g. https://yoursite.com/logo.png)')
    .max(2048)
    .nullable()
    .optional(),
  whiteLabelColor: z.string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Enter a valid hex color code (e.g. #0052CC)')
    .nullable()
    .optional(),
});

type PatchBody = z.infer<typeof patchSchema>;

function formatClient(
  client: Record<string, unknown>,
  locations: Record<string, unknown>[],
  email: string,
  integrations: Record<string, unknown>[],
) {
  const google = integrations.find((i) => i.provider === 'google');
  const facebook = integrations.find((i) => i.provider === 'facebook');
  return {
    id: client.id,
    email,
    businessName: client.business_name,
    industry: client.industry,
    billing: {
      plan: client.subscription_tier ?? 'free',
      status: client.subscription_status ?? 'inactive',
    },
    integrations: {
      google: { connected: google?.status === 'connected' },
      facebook: {
        connected: facebook?.status === 'connected',
        pageName: facebook?.external_account_name ?? null,
      },
    },
    onboardingStep: client.onboarding_step,
    emrProvisioningStatus: client.emr_provisioning_status,
    whiteLabel: {
      companyName: client.white_label_company_name ?? null,
      logoUrl: client.white_label_logo_url ?? null,
      color: client.white_label_color ?? null,
    },
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
    const [locations, user, integrations] = await Promise.all([
      db('locations').where({ client_id: req.clientId }).orderBy('is_primary', 'desc').orderBy('created_at', 'asc'),
      db('users').where({ id: req.client.user_id }).first(),
      db('integrations').where({ client_id: req.clientId }),
    ]);
    ok(res, formatClient(req.client, locations, (user as Record<string, unknown>)?.email as string ?? '', integrations as Record<string, unknown>[]));
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
    if (body.whiteLabelCompanyName !== undefined) updates.white_label_company_name = body.whiteLabelCompanyName;
    if (body.whiteLabelLogoUrl !== undefined) updates.white_label_logo_url = body.whiteLabelLogoUrl;
    if (body.whiteLabelColor !== undefined) updates.white_label_color = body.whiteLabelColor;

    const [updated] = await db('clients').where({ id: req.clientId }).update(updates).returning('*');

    const [locations, user, integrations] = await Promise.all([
      db('locations').where({ client_id: req.clientId }).orderBy('is_primary', 'desc').orderBy('created_at', 'asc'),
      db('users').where({ id: req.client.user_id }).first(),
      db('integrations').where({ client_id: req.clientId }),
    ]);
    ok(res, formatClient(updated as Record<string, unknown>, locations, (user as Record<string, unknown>)?.email as string ?? '', integrations as Record<string, unknown>[]));

  } catch (e) {
    next(e);
  }
}

const ONBOARDING_TOTAL_STEPS = 4;

export async function completeOnboarding(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await db('clients').where({ id: req.clientId }).update({
      onboarding_step: ONBOARDING_TOTAL_STEPS,
      updated_at: new Date(),
    });

    // Provision EMR sub-account with a 12-second timeout.
    // Failure is non-fatal — user proceeds to dashboard; provisioning retried on next login.
    let provisioned = false;
    try {
      const race = Promise.race([
        provisionClient(req.clientId),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 12_000)),
      ]);
      await race;
      provisioned = true;
    } catch (e) {
      logger.warn('EMR provisioning failed or timed out during onboarding', {
        clientId: req.clientId,
        error: (e as Error).message,
      });
      await db('clients').where({ id: req.clientId }).update({ emr_provisioning_status: 'failed' });
    }

    // Kick off citation scan immediately so data appears within minutes, not the next day
    try {
      await citationsQueue.add('onboarding-pull', { clientId: req.clientId });
    } catch (e) {
      logger.warn('Failed to enqueue citations job on onboarding', {
        clientId: req.clientId,
        error: (e as Error).message,
      });
    }

    // Kick off initial rankings pull so the Rankings page is populated right away
    // rather than waiting until the next daily job at 06:00 UTC.
    try {
      await rankingsQueue.add('onboarding-pull', { clientId: req.clientId });
    } catch (e) {
      logger.warn('Failed to enqueue rankings job on onboarding', {
        clientId: req.clientId,
        error: (e as Error).message,
      });
    }

    ok(res, { provisioned });
  } catch (e) {
    next(e);
  }
}

export async function retryProvision(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const client = await db('clients').where({ id: req.clientId }).first();
    if (client?.emr_provisioning_status === 'provisioned') {
      ok(res, { provisioned: true, message: 'Already provisioned' });
      return;
    }

    await provisionClient(req.clientId);
    ok(res, { provisioned: true });
  } catch (e) {
    next(e);
  }
}

export async function emrCredentials(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const client = await db('clients')
      .where({ id: req.clientId })
      .select('emr_customer_id', 'emr_provisioning_status', 'emr_password_encrypted')
      .first();

    const user = await db('users').where({ id: req.userId }).select('email').first();

    const ready = !!client?.emr_customer_id && !!client?.emr_password_encrypted;
    const password = ready ? decrypt(client.emr_password_encrypted as string) : null;

    ok(res, {
      ready,
      loginUrl: 'https://app.superlocalseo.com/login',
      email: ready ? (user?.email as string) : null,
      password,
    });
  } catch (e) {
    next(e);
  }
}
