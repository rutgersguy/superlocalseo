import { db } from '../db/connection';
import { encrypt, decrypt } from '../utils/crypto';
import { config } from '../config';
import { logger } from '../utils/logger';
import {
  createCustomer,
  deleteCustomer,
  suspendCustomer,
  createLocation,
  listOrganizations,
} from './embedmyreviews.service';

/**
 * Ensures the client has its OWN EMR location, and returns its id.
 *
 * This is the unit of tenancy. The agency operator key is the only key we can use (EMR mints
 * per-customer tokens in its dashboard only, and an agency token can't scope to a customer's
 * data), so isolation has to come from the location: `connect-links` attaches a client's
 * Google profile to a location, and `GET /reviews?location_id=` reads back only that
 * client's reviews. Without this every client shared the org-wide review set.
 *
 * Idempotent — returns the stored id if one already exists.
 */
export async function ensureEmrLocation(clientId: string): Promise<number | null> {
  const client = await db('clients').where({ id: clientId }).first();
  if (!client) throw new Error(`Client ${clientId} not found`);

  if (client.emr_location_id) return client.emr_location_id as number;

  const operatorKey = config.embedmyreviews.apiKey;
  if (!operatorKey) {
    logger.warn('EMR not configured — cannot provision location', { clientId });
    return null;
  }

  const orgs = await listOrganizations(operatorKey);
  const org = orgs[0];
  if (!org) throw new Error('EMR: no organization on the agency account');

  // Name it so a human staring at the EMR dashboard can tell whose location this is.
  const label = `${(client.business_name as string) ?? 'Client'} [${clientId.slice(0, 8)}]`;
  const location = await createLocation(operatorKey, org.id, label);

  await db('clients').where({ id: clientId }).update({
    emr_organization_id: location.organizationId,
    emr_location_id: location.id,
    updated_at: new Date(),
  });

  logger.info('EMR location provisioned', { clientId, locationId: location.id, orgId: location.organizationId });
  return location.id;
}

/**
 * Returns the EMR API key to use for a given client.
 * - Prefers the per-client key stored in integrations (provisioned via EMR-1).
 * - Falls back to the operator-level key from config for legacy clients.
 * Returns null only when neither exists (EMR not configured at all).
 */
export async function getClientEMRKey(clientId: string): Promise<string | null> {
  const integration = await db('integrations')
    .where({ client_id: clientId, provider: 'embedmyreviews', status: 'connected' })
    .whereNotNull('api_key_encrypted')
    .first();

  if (integration) {
    return decrypt(integration.api_key_encrypted as string);
  }

  // Fallback: operator key covers all legacy clients
  return config.embedmyreviews.apiKey || null;
}

/**
 * Creates an EMR sub-account for a client and stores the per-client API key
 * in the integrations table.  Safe to call multiple times — idempotent.
 */
export async function provisionClient(clientId: string): Promise<void> {
  const client = await db('clients').where({ id: clientId }).first();
  if (!client) throw new Error(`Client ${clientId} not found`);

  if (client.emr_provisioning_status === 'provisioned') {
    logger.info('EMR already provisioned for client, skipping', { clientId });
    return;
  }

  const user = await db('users').where({ id: client.user_id }).first();
  const email = (user?.email as string) ?? `client+${clientId}@superlocalseo.com`;
  const businessName = (client.business_name as string) ?? 'Business';

  let customerId: string | undefined;
  let emrPassword: string | undefined;

  try {
    const result = await createCustomer(businessName, email);
    customerId = result.customerId;
    emrPassword = result.password;
  } catch (e) {
    logger.error('EMR agency sub-account creation failed', {
      clientId,
      error: (e as Error).message,
    });
  }

  const now = new Date();

  // Only claim 'provisioned' when we actually got a customer id back. This used to be set
  // unconditionally, so a failed createCustomer was permanently marked done — and the early
  // return at the top of this function meant it could never be retried. 'failed' leaves the
  // door open for a retry (and is visible in the DB instead of silently looking healthy).
  await db('clients').where({ id: clientId }).update({
    ...(customerId ? { emr_customer_id: customerId } : {}),
    ...(emrPassword ? { emr_password_encrypted: encrypt(emrPassword) } : {}),
    emr_provisioning_status: customerId ? 'provisioned' : 'failed',
    updated_at: now,
  });

  // Keep integrations row pointing to the shared operator key for review reads
  const operatorKey = config.embedmyreviews.apiKey;
  if (operatorKey) {
    const existing = await db('integrations')
      .where({ client_id: clientId, provider: 'embedmyreviews' })
      .first();
    if (existing) {
      await db('integrations').where({ id: existing.id }).update({
        api_key_encrypted: encrypt(operatorKey),
        status: 'connected',
        error_message: null,
        updated_at: now,
      });
    } else {
      await db('integrations').insert({
        client_id: clientId,
        provider: 'embedmyreviews',
        api_key_encrypted: encrypt(operatorKey),
        status: 'connected',
        created_at: now,
        updated_at: now,
      });
    }
  }

  // The location is what actually makes review reads client-scoped (see ensureEmrLocation).
  // Non-fatal: a client with no location simply syncs no reviews, which is strictly better
  // than the old behaviour of syncing SOMEONE ELSE'S reviews.
  try {
    await ensureEmrLocation(clientId);
  } catch (e) {
    logger.error('EMR location provisioning failed', { clientId, error: (e as Error).message });
  }

  logger.info('EMR provisioned for client', { clientId, customerId: customerId ?? 'none', hasPassword: !!emrPassword });
}

/**
 * Suspends the EMR sub-account when a subscription is canceled.
 * Does not delete — data is retained for potential reactivation.
 */
export async function deprovisionClient(clientId: string): Promise<void> {
  const client = await db('clients').where({ id: clientId }).first();
  if (!client?.emr_customer_id) return;

  try {
    await suspendCustomer(client.emr_customer_id as string);
    await db('clients').where({ id: clientId }).update({
      emr_provisioning_status: 'deprovisioned',
      updated_at: new Date(),
    });
    await db('integrations')
      .where({ client_id: clientId, provider: 'embedmyreviews' })
      .update({ status: 'disconnected', updated_at: new Date() });

    logger.info('EMR customer deprovisioned', { clientId, customerId: client.emr_customer_id });
  } catch (e) {
    logger.warn('EMR deprovision failed (non-fatal)', { clientId, error: (e as Error).message });
  }
}

/**
 * Hard-deletes the EMR sub-account. Used only when a client record is
 * permanently deleted from the system.
 */
export async function deleteClientEMR(clientId: string): Promise<void> {
  const client = await db('clients').where({ id: clientId }).first();
  if (!client?.emr_customer_id) return;

  try {
    await deleteCustomer(client.emr_customer_id as string);
    logger.info('EMR customer deleted', { clientId, customerId: client.emr_customer_id });
  } catch (e) {
    logger.warn('EMR customer delete failed (non-fatal)', { clientId, error: (e as Error).message });
  }
}
