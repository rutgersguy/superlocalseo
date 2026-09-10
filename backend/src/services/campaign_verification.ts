import { createHash } from 'crypto';
export const CAMPAIGN_TEMPLATE_VERSION = 'honest-email-v1';
export function verificationBinding(location: any, client: any, campaign: any): string {
  return createHash('sha256').update(JSON.stringify([location.id, location.name, location.address, location.city,
    location.state, location.zip, location.google_place_id, String(client.emr_organization_id),
    String(client.emr_location_id), campaign.emr_campaign_id, campaign.name])).digest('hex');
}
export function setupView(row: any, location: any, client: any, campaigns: any[], locationCount: number) {
  const v = row.verification;
  const campaign = campaigns.find(c => c.emr_campaign_id === v?.campaignId);
  const valid = row.status === 'verified' && v && campaign && locationCount === 1 &&
    v.binding === verificationBinding(location, client, campaign);
  return { id: row.id, locationId: row.location_id, requestedAt: row.created_at, updatedAt: row.updated_at,
    revision: row.revision, status: row.status === 'verified' && !valid ? 'needs_reverification' : row.status,
    verifiedAt: valid ? v.verifiedAt : null, campaignName: valid ? campaign.name : null,
    templateVersion: valid ? v.templateVersion : null };
}
