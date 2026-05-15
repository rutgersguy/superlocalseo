import { db } from '../db/connection';
import { encrypt, decrypt } from '../utils/crypto';
import { config } from '../config';
import { logger } from '../utils/logger';
import { createCustomer, deleteCustomer, suspendCustomer } from './embedmyreviews.service';

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
    logger.warn('EMR agency sub-account creation failed', {
      clientId,
      error: (e as Error).message,
    });
  }

  const now = new Date();

  await db('clients').where({ id: clientId }).update({
    ...(customerId ? { emr_customer_id: customerId } : {}),
    ...(emrPassword ? { emr_password_encrypted: encrypt(emrPassword) } : {}),
    emr_provisioning_status: 'provisioned',
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
