import { db } from '../db/connection';
import { encrypt, decrypt } from '../utils/crypto';
import { config } from '../config';
import { logger } from '../utils/logger';
import {
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
 * Provisions a client's EMR presence: an organization + a location.
 *
 * NOTE: this no longer creates an EMR "customer" sub-account. Those were vestigial and
 * actively harmful:
 *   - We cannot read a sub-account's data at all (an agency token can't scope to a customer,
 *     and EMR mints per-customer tokens only in its dashboard), so reviews never came from
 *     there — a client who linked Google inside that portal would see nothing, forever.
 *   - The credentials card that surfaced those logins is gone (PR #134).
 *   - A failed createCustomer left behind a scary `emr_provisioning_status = 'failed'` on an
 *     otherwise perfectly working client (observed on Family Tree Roofing).
 *
 * Tenancy lives in the ORGANIZATION + LOCATION instead:
 *   - reviews  filter by location_id
 *   - campaigns filter by organization_id  (they do NOT accept a location filter)
 * so a client needs its own organization for campaigns to be isolated, and its own location
 * for reviews to be isolated. Idempotent.
 */
export async function provisionClient(clientId: string): Promise<void> {
  const client = await db('clients').where({ id: clientId }).first();
  if (!client) throw new Error(`Client ${clientId} not found`);

  const operatorKey = config.embedmyreviews.apiKey;
  if (!operatorKey) {
    logger.warn('EMR not configured — skipping provisioning', { clientId });
    return;
  }

  const now = new Date();

  try {
    await ensureEmrLocation(clientId);
    await db('clients').where({ id: clientId }).update({
      emr_provisioning_status: 'provisioned',
      updated_at: now,
    });
  } catch (e) {
    logger.error('EMR provisioning failed', { clientId, error: (e as Error).message });
    await db('clients').where({ id: clientId }).update({
      emr_provisioning_status: 'failed',
      updated_at: now,
    }).catch(() => undefined);
    return;
  }

  // The integrations row carries the operator key — the only key we can use. Isolation comes
  // from the location/organization scoping, not from the key.
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

  logger.info('EMR provisioned for client', { clientId });
}

/**
 * Called when a subscription is canceled. Stops review syncing for the client.
 *
 * We no longer create EMR sub-accounts, so there is nothing to "suspend" upstream — and
 * pausing is not what protects us anyway. Marking the integration disconnected is: reviews.job
 * only syncs `status = 'connected'` rows, so this genuinely stops the pull. Legacy clients
 * that still carry an emr_customer_id also get their sub-account paused, for tidiness.
 */
export async function deprovisionClient(clientId: string): Promise<void> {
  const client = await db('clients').where({ id: clientId }).first();
  if (!client) return;

  const now = new Date();

  await db('integrations')
    .where({ client_id: clientId, provider: 'embedmyreviews' })
    .update({ status: 'disconnected', updated_at: now });

  await db('clients').where({ id: clientId }).update({
    emr_provisioning_status: 'deprovisioned',
    updated_at: now,
  });

  // Legacy only — new clients have no sub-account.
  if (client.emr_customer_id) {
    try {
      await suspendCustomer(client.emr_customer_id as string);
    } catch (e) {
      logger.warn('EMR legacy sub-account pause failed (non-fatal)', { clientId, error: (e as Error).message });
    }
  }

  logger.info('EMR deprovisioned — review sync stopped', { clientId });
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
