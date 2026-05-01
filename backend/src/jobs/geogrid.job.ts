import { Job } from 'bullmq';
import { pollPending } from '../controllers/geogrid.controller';

export async function processGeoGrid(_job: Job): Promise<void> {
  await pollPending();
}
