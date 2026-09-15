export const INITIAL_STEPS = ['rankings', 'citations', 'ai', 'reviews', 'map', 'audit'] as const;
export type InitialStep = typeof INITIAL_STEPS[number];
export function initialWaitingReason(step: InitialStep, loc: Record<string, any>, hasKeyword: boolean, hasReviewConnection: boolean): string | null {
  if (!['active', 'trialing'].includes(loc.subscription_status)) return 'An active subscription or trial is required.';
  if (loc.subscription_status === 'trialing' && loc.trial_ends_at && new Date(loc.trial_ends_at).getTime() <= Date.now()) return 'The trial has ended.';
  if (['citations', 'map', 'audit'].includes(step) && loc.product_line === 'lite') return 'Available on Pro.';
  if (!String(loc.name ?? '').trim()) return 'Add the business name.';
  if (step === 'reviews') return hasReviewConnection ? null : 'Connect Google reviews and verify the provider location mapping.';
  if (step === 'audit') return loc.website?.trim() ? null : 'Add the business website.';
  if (!loc.city?.trim() || !loc.state?.trim()) return 'Add the business city and state.';
  if (['rankings', 'map'].includes(step) && !hasKeyword) return 'Add at least one keyword.';
  if (step === 'map' && !loc.address?.trim()) return 'Add a business address so the map can be centered on the location.';
  if (step === 'map' && (!Number.isFinite(Number(loc.lat)) || loc.lat == null || !Number.isFinite(Number(loc.lng)) || loc.lng == null)) return 'Waiting for location coordinates.';
  return null;
}
