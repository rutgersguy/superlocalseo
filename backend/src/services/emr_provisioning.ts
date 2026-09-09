import type { Knex } from 'knex';
import { db } from '../db/connection';
import { encrypt, decrypt } from '../utils/crypto';
import { config } from '../config';
import { logger } from '../utils/logger';
import {
  deleteCustomer,
  suspendCustomer,
  createOrganization,
  renameLocation,
  createLocation,
} from './embedmyreviews.service';

/**
 * Ensures the client has its OWN EMR organization AND location. Returns the location id.
 *
 * BOTH are required, because EMR scopes the two things we sync differently:
 *   - reviews   filter by location_id
 *   - campaigns filter by organization_id  (there is NO location filter)
 * so a client sharing an organization cannot have isolated campaigns, and a client sharing a
 * location cannot have isolated reviews.
 *
 * Every client used to live in the single agency org (id 1), which meant campaigns could not
 * be isolated at all — reviews.job had to refuse to sync them. Each client now gets a
 * dedicated org; EMR auto-creates a "Default Location" inside it, which we rename and use.
 *
 * A location CANNOT be moved between organizations — PUT /locations/{id} accepts
 * organization_id, returns 200, and silently ignores it (verified 2026-07-14). So a client
 * stuck in a shared org requires an explicit operator mapping check. Normal customer
 * requests never relocate it. `force` is reserved for intentional operator recovery.
 *
 * Idempotent: returns the stored location when the client already has a dedicated org.
 */
export async function ensureEmrTenancy(clientId: string, force = false): Promise<number | null> {
  // A checked-out session holds the advisory lock while each ID write commits.
  // This avoids holding a transaction that would roll back external-create evidence.
  const connection = await db.client.acquireConnection();
  let reusable = true;
  try {
    await db.raw('SELECT pg_advisory_lock(hashtext(?))', [`emr-provision:${clientId}`]).connection(connection);
    return await provisionTenancyLocked(clientId, force, table => db(table).connection(connection));
  } finally {
    try { await db.raw('SELECT pg_advisory_unlock(hashtext(?))', [`emr-provision:${clientId}`]).connection(connection); }
    catch { reusable = false; await db.client.destroyConnection(connection); }
    if (reusable) await db.client.releaseConnection(connection);
  }
}

async function provisionTenancyLocked(clientId: string, force: boolean, query: (table: string) => Knex.QueryBuilder): Promise<number | null> {
  const client = await query('clients').where({ id: clientId }).first();
  if (!client) throw new Error('Client not found');
  const operatorKey = config.embedmyreviews.apiKey;
  if (!operatorKey) return null;
  const orgId = client.emr_organization_id as number | null;
  const locationId = client.emr_location_id as number | null;
  const needsCheck = () => Object.assign(new Error('Review setup needs an account mapping check. Contact support before retrying.'), { status: 409, code: 'CONNECTION_MAPPING_REQUIRED' });
  if (!force && orgId && locationId) {
    const shared = await query('clients').whereNot({ id: clientId }).where(q => q
      .where({ emr_organization_id: orgId }).orWhere({ emr_location_id: locationId })).first();
    if (shared) throw needsCheck();
    return locationId;
  }
  // An unacknowledged external create may already exist. Never blindly repeat it.
  if (!force && (orgId || locationId || client.emr_provisioning_status === 'creating')) throw needsCheck();
  const label = `${client.business_name ?? 'Client'} [${clientId.slice(0, 8)}]`;
  await query('clients').where({ id: clientId }).update({ emr_provisioning_status: 'creating', updated_at: new Date() });
  let org;
  try { org = await createOrganization(operatorKey, label); }
  catch (e) {
    const status = (e as { providerStatus?: number }).providerStatus;
    if (status && status >= 400 && status < 500 && status !== 408) {
      await query('clients').where({ id: clientId }).update({ emr_provisioning_status: 'failed', updated_at: new Date() });
    }
    throw e;
  }
  await query('clients').where({ id: clientId }).update({ emr_organization_id: org.id, emr_location_id: org.defaultLocationId, updated_at: new Date() });
  const newLocationId = org.defaultLocationId ?? (await createLocation(operatorKey, org.id, label)).id;
  await query('clients').where({ id: clientId }).update({ emr_location_id: newLocationId, emr_provisioning_status: 'provisioned', updated_at: new Date() });
  // Naming is cosmetic; an outage here must not create another organization on retry.
  await renameLocation(operatorKey, newLocationId, label).catch(() => logger.warn('Review location naming needs a retry', { clientId }));
  return newLocationId;
}

/** @deprecated Use ensureEmrTenancy — a location alone does not isolate campaigns. */
export const ensureEmrLocation = ensureEmrTenancy;

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
    await ensureEmrTenancy(clientId);
    await db('clients').where({ id: clientId }).update({
      emr_provisioning_status: 'provisioned',
      updated_at: now,
    });
  } catch (e) {
    logger.error('EMR provisioning failed', { clientId, error: (e as Error).message });
    await db('clients').where({ id: clientId }).whereNot({ emr_provisioning_status: 'creating' }).update({
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
