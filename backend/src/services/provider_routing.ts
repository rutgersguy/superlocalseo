import type { Knex } from 'knex';
import { db } from '../db/connection';
import { mappingIdentity, mappingError } from './provider_mapping.service';

export interface ProviderRoute { clientId: string; localLocationId: string | null; organizationId: string; providerLocationId: string; mode: 'explicit' | 'legacy'; revision: number | null }
export async function resolveProviderRoute(clientId: string, localLocationId?: string, query: Knex | Knex.Transaction = db): Promise<ProviderRoute | null> {
  const locations = await query('locations').where({ client_id: clientId });
  const location = localLocationId ? locations.find(l => l.id === localLocationId) : locations.length === 1 ? locations[0] : null;
  if (localLocationId && !location) throw mappingError('Location not found', 404);
  if (!localLocationId && locations.length > 1) throw mappingError('Select a business location before continuing.');
  const mappings = await query('provider_location_mappings').where({ client_id: clientId });
  const mapping = mappings.find(m => m.location_id === location?.id);
  let organizationId: string, providerLocationId: string;
  if (mappings.length) {
    if (!mapping || !location || mapping.evidence?.localIdentity !== mappingIdentity(location)) throw mappingError('This location needs a current provider mapping inspection. Contact support.');
    const owner = await query('provider_organization_owners').where({ organization_id: mapping.organization_id, client_id: clientId }).first();
    if (!owner) throw mappingError('Provider ownership needs reconciliation.');
    organizationId = String(mapping.organization_id); providerLocationId = String(mapping.provider_location_id);
  } else {
    if (locations.length > 1) throw mappingError('Each branch needs an explicit provider mapping. Contact support.');
    const client = await query('clients').where({ id: clientId }).first();
    if (!client?.emr_organization_id || !client.emr_location_id) return null;
    organizationId = String(client.emr_organization_id); providerLocationId = String(client.emr_location_id);
  }
  const legacyConflict = await query('clients').whereNot({ id: clientId }).where(q => q.whereRaw('emr_organization_id::text = ?', [organizationId]).orWhereRaw('emr_location_id::text = ?', [providerLocationId])).first();
  const registryConflict = await query('provider_organization_owners').where({ organization_id: organizationId }).whereNot({ client_id: clientId }).first();
  const locationConflict = await query('provider_location_mappings').where({ provider_location_id: providerLocationId }).whereNot({ client_id: clientId }).first();
  if (legacyConflict || registryConflict || locationConflict) throw mappingError('Provider routing conflicts with another customer. Contact support.');
  return { clientId, localLocationId: location?.id ?? null, organizationId, providerLocationId, mode: mapping ? 'explicit' : 'legacy', revision: mapping?.revision ?? null };
}
export async function providerRoutes(clientId: string, locationId?: string): Promise<ProviderRoute[]> {
  if (locationId) { const route = await resolveProviderRoute(clientId, locationId); return route ? [route] : []; }
  const mappings = await db('provider_location_mappings').where({ client_id: clientId });
  if (!mappings.length) { const route = await resolveProviderRoute(clientId); return route ? [route] : []; }
  const routes: ProviderRoute[] = [];
  for (const m of mappings) { const route = await resolveProviderRoute(clientId, m.location_id); if (route) routes.push(route); }
  return routes;
}
/** Serializes route changes and local identity edits while committing results or performing a scoped write. */
export async function withProviderRoute<T>(route: ProviderRoute, fn: (trx: Knex.Transaction) => Promise<T>): Promise<T> {
  return db.transaction(async trx => {
    await trx.raw("SELECT pg_advisory_xact_lock(hashtext('provider-location-mapping-v1'))");
    await trx('clients').where({ id: route.clientId }).forShare();
    await trx('locations').where({ client_id: route.clientId }).orderBy('id').forShare();
    const current = await resolveProviderRoute(route.clientId, route.localLocationId ?? undefined, trx);
    if (JSON.stringify(current) !== JSON.stringify(route)) throw mappingError('Provider mapping changed. Refresh and retry.');
    return fn(trx);
  });
}
