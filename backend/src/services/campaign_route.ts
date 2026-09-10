import { z } from 'zod';
import { db } from '../db/connection';
import { resolveProviderRoute } from './provider_routing';
import { mappedCampaignClient, setupView } from './campaign_verification';

export async function campaignRoute(clientId: string, campaignId: string, locationId?: unknown) {
  const selected = z.string().uuid().optional().parse(locationId);
  const requests = await db('campaign_setup_requests').where({ client_id: clientId, status: 'verified' }).whereRaw("verification->>'campaignId' = ?", [campaignId]);
  const candidates = requests.filter(r => !selected || r.location_id === selected);
  if (candidates.length !== 1) throw Object.assign(new Error('This campaign needs a verified setup for one business location before invitations can be sent.'), { status: 409 });
  const request = candidates[0];
  const locations = await db('locations').where({ client_id: clientId });
  const location = locations.find(l => l.id === request.location_id);
  const client = await db('clients').where({ id: clientId }).first();
  const mappings = await db('provider_location_mappings').where({ client_id: clientId });
  const campaigns = await db('emr_campaigns').where({ client_id: clientId, emr_campaign_id: campaignId });
  if (setupView(request, location, mappedCampaignClient(client, location, mappings), campaigns, locations.length).status !== 'verified') throw Object.assign(new Error('Campaign setup changed. Ask support to verify it again.'), { status: 409 });
  const route = await resolveProviderRoute(clientId, request.location_id);
  if (!route) throw Object.assign(new Error('Provider mapping is required.'), { status: 409 });
  return route;
}

