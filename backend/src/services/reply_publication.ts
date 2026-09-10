import { db } from '../db/connection';
import { mappingError } from './provider_mapping.service';
import { resolveProviderRoute, withProviderRoute, ProviderRoute } from './provider_routing';
import { getClientEMRKey } from './emr_provisioning';
import { readReplyState, replyToReview, EMRReplyError } from './embedmyreviews.service';

export const immutableReplyStates = ['publishing', 'uncertain', 'posted', 'reply_conflict'];
async function context(clientId: string, reviewId: string) {
  const review = await db('reviews').where({ id: reviewId, client_id: clientId }).first();
  if (!review) throw mappingError('Review not found', 404);
  if (review.source !== 'emr' || !['google', 'facebook'].includes(String(review.platform).toLowerCase())) throw mappingError('This review source does not support publishing here.', 400);
  const route = await resolveProviderRoute(clientId, review.location_id ?? undefined);
  if (!route || (route.mode === 'explicit' && (!review.location_id || review.emr_provider_location_id !== route.providerLocationId))) throw mappingError('Refresh reviews for this mapped location before publishing a reply.');
  const key = await getClientEMRKey(clientId);
  if (!key) throw mappingError('Review platform is not configured', 503);
  return { review, route, key };
}
async function observed(clientId: string, reviewId: string, route: ProviderRoute, key: string, externalId: string) {
  const state = await readReplyState(key, externalId);
  if (state.id !== String(externalId) || state.organizationId !== route.organizationId || state.locationId !== route.providerLocationId || !['google', 'facebook'].includes(state.source.toLowerCase())) throw mappingError('Provider review identity does not match this business. Contact support.');
  if (!state.reply) return false;
  await withProviderRoute(route, async trx => {
    const response = await trx('review_responses').where({ review_id: reviewId, client_id: clientId }).forUpdate().first();
    await trx('reviews').where({ id: reviewId, client_id: clientId }).update({ replied: true, emr_reply_text: state.reply, reply_date: state.replyDate, status: 'responded' });
    if (response) await trx('review_responses').where({ id: response.id }).update({ status: response.final_body === state.reply ? 'posted' : 'reply_conflict', last_publish_error: response.final_body === state.reply ? null : 'A different reply already exists on the provider. No additional reply was sent.', reconcile_checked_at: new Date(), updated_at: new Date() });
  });
  return true;
}
export async function reconcileReply(clientId: string, reviewId: string) {
  const { review, route, key } = await context(clientId, reviewId);
  const response = await db('review_responses').where({ client_id: clientId, review_id: reviewId }).first();
  if (!response || !immutableReplyStates.includes(response.status)) throw mappingError('No pending publication to check.');
  if (response.publish_route && Object.keys(route).some(k => response.publish_route[k] !== route[k as keyof ProviderRoute])) throw mappingError('The mapping changed since publication. Support must reconcile the original business.');
  const found = await observed(clientId, reviewId, route, key, review.external_review_id);
  if (!found) await db('review_responses').where({ id: response.id }).update({ reconcile_checked_at: new Date(), last_publish_error: 'No reply is visible at the provider yet. Publication remains unresolved; no resend was attempted.' });
  return { published: found, checked: true, retryAllowed: false };
}
export async function publishReply(clientId: string, reviewId: string, text: string) {
  const { review, route, key } = await context(clientId, reviewId);
  await withProviderRoute(route, async trx => {
    await trx.raw('SELECT pg_advisory_xact_lock(hashtext(?))', [`reply:${reviewId}`]);
    const currentReview = await trx('reviews').where({ id: reviewId, client_id: clientId }).forUpdate().first();
    const current = await trx('review_responses').where({ review_id: reviewId, client_id: clientId }).forUpdate().first();
    if (currentReview.replied || (current && immutableReplyStates.includes(current.status))) throw mappingError('A reply exists or its publication is unresolved. Check publication status before continuing.');
    const values = { final_body: text, status: 'publishing', approved_at: new Date(), publishing_started_at: new Date(), publish_route: JSON.stringify(route), last_publish_error: null, updated_at: new Date() };
    if (current) await trx('review_responses').where({ id: current.id }).update(values);
    else await trx('review_responses').insert({ client_id: clientId, review_id: reviewId, draft_body: text, ...values });
  });
  let attempted = false;
  try {
    // Always reconcile the authoritative provider identity and existing reply before a new write.
    if (await observed(clientId, reviewId, route, key, review.external_review_id)) return { published: true, reconciled: true };
    await withProviderRoute(route, async () => {
      attempted = true;
      await replyToReview(key, review.external_review_id, text);
    });
    await db.transaction(async trx => {
      await trx('reviews').where({ id: reviewId, client_id: clientId }).update({ replied: true, reply_date: new Date(), emr_reply_text: text, status: 'responded' });
      await trx('review_responses').where({ review_id: reviewId, client_id: clientId }).update({ status: 'posted', last_publish_error: null, updated_at: new Date() });
    });
    return { published: true, reconciled: false };
  } catch (error) {
    const definite = !attempted || (error instanceof EMRReplyError && [402,403,404,422].includes(error.httpStatus));
    await db('review_responses').where({ review_id: reviewId, client_id: clientId }).whereNotIn('status', ['posted','reply_conflict']).update({ status: definite ? 'failed' : 'uncertain', last_publish_error: definite ? 'Publication did not complete. Check the connection and source before trying again.' : 'Publication outcome is unknown. Check publication status; do not resend.', updated_at: new Date() });
    if (!definite) throw mappingError('Publication outcome is unknown. Use Check publication status. No automatic resend will occur.');
    if (error instanceof EMRReplyError) throw Object.assign(error, { status: error.httpStatus });
    throw error;
  }
}
