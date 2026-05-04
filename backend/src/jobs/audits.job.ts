import { Job } from 'bullmq';
import { db } from '../db/connection';
import { createAuditReport } from '../services/brightlocal.service';
import { pollPending } from '../controllers/audit_bl.controller';
import { logger } from '../utils/logger';

export async function processAudits(job: Job): Promise<void> {
  if (!job.data.locationId) {
    // Monthly fan-out: trigger for all active locations with a BL campaign
    const locations = await db('locations')
      .join('clients', 'locations.client_id', 'clients.id')
      .whereNotIn('clients.subscription_status', ['canceled', 'past_due'])
      .whereNotNull('locations.brightlocal_campaign_id')
      .select('locations.id as locationId', 'locations.client_id as clientId', 'locations.brightlocal_campaign_id as campaignId') as Array<{ locationId: string; clientId: string; campaignId: string }>;

    logger.info(`Audit fan-out: ${locations.length} locations`);
    for (const loc of locations) {
      try {
        const { reportId } = await createAuditReport(loc.campaignId);
        await db('location_audits').insert({
          client_id: loc.clientId,
          location_id: loc.locationId,
          bl_report_id: reportId,
          status: 'processing',
        });
      } catch (e) {
        logger.warn('Audit fan-out failed for location', { locationId: loc.locationId, error: (e as Error).message });
      }
    }
    return;
  }

  await pollPending();
}
