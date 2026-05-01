import { Job } from 'bullmq';
import { db } from '../db/connection';
import { decrypt } from '../utils/crypto';
import { fetchCitations } from '../services/brightlocal.service';
import { logger } from '../utils/logger';

export async function processCitations(job: Job): Promise<void> {
  const clientId: string | undefined = job.data?.clientId;

  // Get all locations that have a BrightLocal campaign ID and connected integration
  let locationsQuery = db('locations')
    .join('integrations', function () {
      this.on('integrations.client_id', '=', 'locations.client_id')
        .andOn(db.raw("integrations.provider = 'brightlocal'"))
        .andOn(db.raw("integrations.status = 'connected'"));
    })
    .whereNotNull('locations.brightlocal_campaign_id')
    .whereNotNull('integrations.api_key_encrypted')
    .select(
      'locations.id as locationId',
      'locations.client_id as clientId',
      'locations.brightlocal_campaign_id as campaignId',
      'integrations.id as integrationId',
      'integrations.api_key_encrypted as encryptedKey',
    );

  if (clientId) {
    locationsQuery = locationsQuery.where('locations.client_id', clientId);
  }

  const locations = await locationsQuery;

  for (const location of locations) {
    try {
      const apiKey = decrypt(location.encryptedKey as string);
      void apiKey; // used implicitly by BrightLocal service via config
      const results = await fetchCitations(location.campaignId as string);

      const now = new Date();

      const rows = results.map((c) => ({
        location_id: location.locationId,
        directory: c.directory,
        listed: c.listed,
        nap_match: c.napMatch,
        listing_url: c.listingUrl,
        pulled_at: now,
        nap_name_match: c.napDetail?.nameMatch ?? null,
        nap_address_match: c.napDetail?.addressMatch ?? null,
        nap_phone_match: c.napDetail?.phoneMatch ?? null,
        listed_name: c.napDetail?.listedName ?? null,
        listed_address: c.napDetail?.listedAddress ?? null,
        listed_phone: c.napDetail?.listedPhone ?? null,
      }));

      if (rows.length > 0) {
        await db('citation_snapshots').insert(rows);
      }

      // Update last_pull_at
      await db('integrations').where({ id: location.integrationId }).update({ last_pull_at: now });

      logger.info('Citations pulled successfully', {
        locationId: location.locationId,
        resultCount: results.length,
      });
    } catch (e) {
      logger.error('Failed to pull citations for location', {
        locationId: location.locationId,
        error: (e as Error).message,
      });

      await db('integrations')
        .where({ id: location.integrationId })
        .update({ error_message: (e as Error).message })
        .catch(() => undefined);
    }
  }
}
