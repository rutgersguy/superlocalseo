import { z } from 'zod';
import { config } from '../config';

export const operatorInspectionSchema = z.object({
  providerPageUrl: z.string().url().max(1000),
  businessName: z.string().trim().min(2).max(255),
  inspectedAt: z.string().datetime(),
  selectedLocationConfirmed: z.literal(true),
  exactPlaceIdConfirmed: z.literal(true),
  customerOwnershipConfirmed: z.literal(true),
}).strict();
export type OperatorInspection = z.infer<typeof operatorInspectionSchema>;
const fail = (message: string, status = 409) => Object.assign(new Error(message), { status });

/** API proves membership only. Connected Google identity is explicitly operator-attested. */
export async function readProviderMappingEvidence(
  organizationId: string, providerLocationId: string, googlePlaceId: string, inspection?: OperatorInspection,
): Promise<{ verifiedAt: string; organizationId: string; providerLocationId: string; googlePlaceId: string; [key: string]: unknown }> {
  if (!/^[1-9][0-9]{0,14}$/.test(organizationId) || !/^[1-9][0-9]{0,14}$/.test(providerLocationId))
    throw fail('Invalid provider identifiers.');
  const parsed = operatorInspectionSchema.safeParse(inspection);
  if (!parsed.success) throw fail('A complete operator inspection is required.');
  const observed = parsed.data;
  const age = Date.now() - Date.parse(observed.inspectedAt);
  if (age < -60000 || age > 30 * 60000) throw fail('Inspect the provider business again; the inspection must be within the last 30 minutes.');
  const page = new URL(observed.providerPageUrl);
  const base = new URL(config.embedmyreviews.baseUrl);
  if (page.origin !== base.origin || page.protocol !== 'https:' || page.username || page.password || page.search || page.hash || page.pathname === '/' || /(?:login|register|connect-links|oauth|review\/)/i.test(page.pathname))
    throw fail('Use the provider dashboard page URL without query parameters, fragments or sign-in links.');
  if (!config.embedmyreviews.apiKey) throw fail('Provider API credentials are not configured.', 503);
  let response: Response;
  try {
    response = await fetch(`${base.origin}/api/v1/locations/${providerLocationId}`, {
      headers: { Authorization: `Bearer ${config.embedmyreviews.apiKey}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(10000), redirect: 'error',
    });
  } catch { throw fail('Provider membership could not be checked. Retry before saving.', 502); }
  if (!response.ok) throw fail(response.status === 404 ? 'Provider location was not found.' : 'Provider membership check failed. Retry before saving.', response.status === 404 ? 409 : 502);
  let body: unknown;
  try { body = await response.json(); } catch { throw fail('Provider membership response was invalid.', 502); }
  const id = z.union([z.number().int().positive().max(Number.MAX_SAFE_INTEGER), z.string().regex(/^[1-9][0-9]{0,14}$/)]).transform(String);
  const location = z.object({ data: z.object({ id, organization_id: id, name: z.string().max(255) }) }).safeParse(body);
  if (!location.success) throw fail('Provider membership response was invalid.', 502);
  if (location.data.data.id !== providerLocationId || location.data.data.organization_id !== organizationId)
    throw fail('The provider location does not belong to the selected organization.');
  if (Date.now() - Date.parse(observed.inspectedAt) > 30 * 60000) throw fail('The inspection expired. Inspect the business again.');
  return { verifiedAt: new Date().toISOString(), organizationId, providerLocationId, googlePlaceId,
    method: 'operator-inspection-with-api-membership-v1', membershipVerified: true, googleIdentityVerification: 'operator_attested',
    providerLocationName: location.data.data.name, inspection: observed };
}
