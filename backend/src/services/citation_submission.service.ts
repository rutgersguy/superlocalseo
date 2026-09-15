import { config } from '../config';
import { db } from '../db/connection';
import { stripe } from './stripe.service';
import { confirmCbCampaign, getCbCampaign, getCbCampaignLookup, type CbPackageId } from './brightlocal.service';
import { getDirectoriesForIndustry } from '../config/industry.config';
import { DIRECTORIES } from '../config/directories.config';

function reject(message: string, status = 422): never {
  throw Object.assign(new Error(message), { status, code: 'SUBMISSION_POLICY' });
}
export function directoryDomain(value: string): string {
  try { return new URL(value.includes('://') ? value : `https://${value}`).hostname.toLowerCase().replace(/^www\./, ''); }
  catch { return ''; }
}
export function submissionDomains(industry: string | null): string[] {
  return getDirectoriesForIndustry(industry).map(k => directoryDomain(DIRECTORIES[k]!.domain));
}
export interface SubmissionOptions {
  packageId: string; citations: string[]; publishers: string[];
  autoSelect?: boolean; removeDuplicates?: boolean; express?: boolean; notes?: string;
  detailsConfirmed?: boolean;
}
export function validateSubmission(options: SubmissionOptions, industry: string | null): string[] {
  if (!['cb10', 'cb15'].includes(options.packageId)) reject('The initial listing allowance supports only 10- or 15-credit packages.');
  if (options.publishers.length || options.autoSelect || options.express || options.removeDuplicates) reject('Aggregators, automatic selection, duplicate removal and expedited service are not included.');
  if (!options.detailsConfirmed) reject('Confirm the business details and that each selected listing needs creation or correction.');
  const domains = options.citations.map(directoryDomain);
  const allowed = new Set(submissionDomains(industry));
  if (!domains.length || domains.some(d => !allowed.has(d)) || new Set(domains).size !== domains.length) reject('Select unique directories from the relevant listing plan.');
  if (domains.length > Number(options.packageId.slice(2))) reject('Selected directories exceed the package allowance.');
  return domains;
}

/** Both admin and tenant routes use this gate. Never retry a paid PUT after an uncertain outcome. */
export async function submitInitialListings(clientId: string, locationId: string, campaignId: string, options: SubmissionOptions): Promise<void> {
  const client = await db('clients').where({ id: clientId }).first();
  const location = await db('locations').where({ id: locationId, client_id: clientId }).first();
  if (!location) reject('Location not found.', 404);
  if (client?.subscription_status !== 'active' || client.product_line !== 'pro' || !client.stripe_subscription_id) reject('Listing submissions begin after a successful paid Pro subscription payment. Trials are not eligible.', 402);
  const domains = validateSubmission(options, client.industry);
  if (!location.brightlocal_location_id) reject('Prepare the listing campaign before submitting.');
  const prior = await db('citation_orders').where({ location_id: locationId }).first();
  if (prior) {
    if (prior.campaign_id === campaignId && prior.status === 'submitted') return;
    reject('An initial listing order already exists. Check its status before taking further action.', 409);
  }
  if (await db('citation_submissions').where({ location_id: locationId }).first()) reject('This location already has submission history. Review its existing allocation before placing another order.', 409);

  // Stripe is the payment authority; an admin-edited active flag cannot unlock credits.
  const subscription = await stripe.subscriptions.retrieve(client.stripe_subscription_id);
  const invoiceId = typeof subscription.latest_invoice === 'string' ? subscription.latest_invoice : subscription.latest_invoice?.id;
  if (subscription.status !== 'active' || subscription.metadata?.plan !== 'pro' || !invoiceId) reject('A current paid subscription is required.', 402);
  const invoice = await stripe.invoices.retrieve(invoiceId);
  if (!invoice.paid || invoice.status !== 'paid' || !(invoice.amount_paid > 0) || (config.isProd && !invoice.livemode) || invoice.paid_out_of_band || invoice.subscription !== subscription.id) reject('A successful non-zero subscription payment is required before submissions.', 402);
  const campaign = await getCbCampaign(campaignId);
  if (Number(campaign.locationId) !== Number(location.brightlocal_location_id)) reject('The campaign does not belong to this location.', 403);
  const lookup = await getCbCampaignLookup(campaignId);
  if (lookup.lookupStatus !== 'complete') reject('Wait for the directory lookup to finish before submitting.');
  const available = new Set(lookup.availableCitations.map(directoryDomain));
  if (domains.some(d => !available.has(d))) reject('One or more selected directories are unavailable through the provider.');

  const reserved = await db.transaction(async trx => {
    const current = await trx('clients').where({ id: clientId }).forUpdate().first();
    if (current.subscription_status !== 'active' || current.product_line !== 'pro' || current.stripe_subscription_id !== subscription.id) reject('Subscription eligibility changed. Refresh before continuing.', 402);
    const rows = await trx('citation_orders').insert({ location_id: locationId, client_id: clientId, campaign_id: campaignId,
      status: 'submitting', credits_reserved: Number(options.packageId.slice(2)), invoice_id: invoice.id,
      directories: JSON.stringify(domains) }).onConflict('location_id').ignore().returning('location_id');
    return rows.length > 0;
  });
  if (!reserved) reject('An initial listing order is already being processed.', 409);
  try {
    await confirmCbCampaign(campaignId, { packageId: options.packageId as CbPackageId, citations: options.citations,
      publishers: [], autoSelect: false, removeDuplicates: false, express: false, notes: options.notes });
    await db.transaction(async trx => {
      await trx('citation_submissions').insert(domains.map(directory => ({ client_id: clientId, location_id: locationId,
        directory, status: 'pending', bl_submission_id: campaignId, submitted_at: new Date() })));
      await trx('citation_orders').where({ location_id: locationId }).update({ status: 'submitted', updated_at: new Date() });
    });
  } catch {
    await db('citation_orders').where({ location_id: locationId }).update({ status: 'needs_review', updated_at: new Date() });
    reject('The provider outcome needs review. The order is reserved to prevent duplicate charges; do not resubmit.', 409);
  }
}
