/**
 * Deliberately closed until a supported EMR response has been verified live.
 * GET /locations/:id documents organization membership, but neither that
 * response nor the documented writable /reviews/sources response establishes
 * the connected Google Place ID. Names and operator-supplied IDs are not proof.
 * Do not enable this by accepting arbitrary evidence from the request body.
 * See docs/provider-location-mappings.md for the remaining activation checks.
 */
export async function readProviderMappingEvidence(
  _organizationId: string, _providerLocationId: string, _googlePlaceId: string,
): Promise<{ verifiedAt: string; organizationId: string; providerLocationId: string; googlePlaceId: string; [key: string]: unknown }> {
  throw Object.assign(new Error('Mapping verification is awaiting a verified provider identity source. No mapping was saved.'), { status: 409 });
}
