/** Operator recovery never purchases an already attempted observation or resends unknown email. */
export function prospectRecovery(data: any, updatedAt: Date | string, now = Date.now()): { allowed: boolean; reason: string } {
  const stale = now - new Date(updatedAt).getTime() > 15 * 60000;
  if (data.generationToken && !stale) return { allowed: false, reason: 'A worker is still processing this request.' };
  if (data.snapshot) {
    if (['not_started', 'rejected'].includes(data.emailStatus)) return { allowed: true, reason: 'Send the saved report to its original recipient; no new scan is purchased.' };
    return { allowed: false, reason: 'Email was accepted or its outcome is unknown. Check the Resend receipt; automatic resend is blocked to prevent duplicates.' };
  }
  if (data.progress?.profileAttemptedAt && !data.progress.business) return { allowed: false, reason: 'The business profile request was attempted but its result was not saved. Verify the provider record before any new paid request; recovery is blocked.' };
  if (data.status === 'failed' || (['processing', 'queued'].includes(data.status) && stale)) return { allowed: true, reason: 'Continue saved progress. Previously attempted points stay unavailable instead of being purchased again.' };
  return { allowed: false, reason: 'This request is already queued or processing.' };
}
