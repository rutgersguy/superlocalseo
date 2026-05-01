import { Job } from 'bullmq';
import { pollSubmissions } from '../controllers/citation.controller';

export async function processCitationBuilder(_job: Job): Promise<void> {
  await pollSubmissions();
}
