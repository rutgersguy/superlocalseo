import { db } from '../db/connection';
import { readProviderMappingEvidence } from './provider_mapping_evidence';

export interface MappingInput { revision: number; organizationId: string; providerLocationId: string; googlePlaceId: string; note: string }
export function mappingError(message: string, status = 409): Error & { status: number } { return Object.assign(new Error(message), { status }); }

export async function saveProviderMapping(locationId: string, input: MappingInput, actorId: string) {
  // Read-only provider verification occurs outside locks; no operator assertion can substitute for it.
  const initial = await db('locations').where({ id: locationId }).first();
  if (!initial) throw mappingError('Location not found', 404);
  if (!initial.google_place_id || initial.google_place_id !== input.googlePlaceId)
    throw mappingError('The saved business Google place ID must match the requested mapping.');
  const evidence = await readProviderMappingEvidence(input.organizationId, input.providerLocationId, input.googlePlaceId);
  if (evidence.organizationId !== input.organizationId || evidence.providerLocationId !== input.providerLocationId || evidence.googlePlaceId !== input.googlePlaceId || !Number.isFinite(Date.parse(evidence.verifiedAt)))
    throw mappingError('Provider identity evidence does not match the requested mapping.');
  return db.transaction(async trx => {
    // Serializes first inserts as well as edits. Constraints independently enforce both tenancy boundaries.
    await trx.raw("SELECT pg_advisory_xact_lock(hashtext('provider-location-mapping-v1'))");
    const clients = await trx('clients').orderBy('id').forUpdate();
    const location = await trx('locations').where({ id: locationId }).forUpdate().first();
    if (!location || location.client_id !== initial.client_id || location.google_place_id !== input.googlePlaceId)
      throw mappingError('Business identity changed during verification. Refresh and try again.');
    const current = await trx('provider_location_mappings').where({ location_id: locationId }).first();
    if ((current?.revision ?? 0) !== input.revision) throw mappingError('This mapping changed. Refresh before saving again.');
    const legacyConflict = clients.find(c => c.id !== location.client_id &&
      (String(c.emr_organization_id) === input.organizationId || String(c.emr_location_id) === input.providerLocationId));
    if (legacyConflict) throw mappingError('These provider IDs are claimed by another customer’s legacy configuration. Reconcile that configuration first.');
    const owner = await trx('provider_organization_owners').where({ organization_id: input.organizationId }).first();
    if (owner && owner.client_id !== location.client_id) throw mappingError('Provider organization belongs to another customer.');
    const duplicate = await trx('provider_location_mappings').where({ provider_location_id: input.providerLocationId }).whereNot({ location_id: locationId }).first();
    if (duplicate) throw mappingError('Provider location is already assigned to another business location.');
    if (!owner) await trx('provider_organization_owners').insert({ organization_id: input.organizationId, client_id: location.client_id });
    const revision = input.revision + 1;
    const row = { location_id: locationId, client_id: location.client_id, organization_id: input.organizationId,
      provider_location_id: input.providerLocationId, google_place_id: input.googlePlaceId, revision,
      note: input.note, evidence: JSON.stringify(evidence), verified_at: evidence.verifiedAt };
    await trx('provider_location_mappings').insert(row).onConflict('location_id').merge();
    await trx('provider_mapping_events').insert({ location_id: locationId, client_id: location.client_id, actor_id: actorId, revision, note: input.note, evidence: JSON.stringify(evidence) });
    return { locationId, revision };
  });
}
