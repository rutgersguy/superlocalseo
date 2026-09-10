# Review synchronization reliability

## Source snapshots

EMR review reads request both the resolved location and organization. Every returned review must match those IDs and contain a usable source, stable ID, publication date, rating and explicit reply state. All pages must be read successfully before rows are committed. Missing data or pagination, conflicting totals, repeated identities and foreign records fail the snapshot. The maximum is 100 pages; a larger account is marked failed for operator investigation rather than silently truncated. Provider totals, when supplied, must reconcile with the collected row count. Snapshot reads do not prove that EMR has imported every review from Google.

A successful empty response records a source count of zero but does not delete previously stored reviews. The inbox explicitly distinguishes these two counts. Deleted-source reconciliation remains a separate operator decision: absence in one read is not authority to delete history.

Each client/provider-location snapshot receives a database generation before fetching. Only the current generation may commit. Thus a slower earlier read cannot overwrite a later-started import. Corrected publication dates update existing records. Reply state from an approval or reconciliation completed while the snapshot was in flight is retained for the next reconciliation. Existing user reply drafts and publication history are preserved.

## Webhooks

Both registered webhook URLs retain their shared authentication guard. Review-created and review-updated events for both explicit and legacy mappings enqueue a scoped API reconciliation; webhook review content is never directly applied. This prevents delayed/partial notifications from restoring stale review or reply text. The handler acknowledges after queue persistence and returns 503 when queue persistence fails. Independent notifications are not dropped merely because an earlier job shares the same minute. Periodic imports remain the fallback. This is not a claim of vendor webhook delivery acceptance.

Private feedback keeps its existing first-seen deduplication behavior; historical backfill and ordered feedback edits remain outside this release. Invalid/ambiguous mappings are not imported; operators must fix mapping conflicts. The test account's intentionally mixed labels are not changed.

## Inbox and status

Reviews → Review import health lists the current EMR mapping's last successful import and complete source count, alongside saved EMR rows. A new or changed mapping is unknown until checked. A failed import retains previous success evidence and reviews. Disconnected/mapping-required states are explicit. A running import older than 15 minutes is shown as stalled; a successful import older than 24 hours is stale. These are local operational thresholds, not provider freshness guarantees. Refreshing status does not trigger an import. Review lists are tenant-scoped, searched using the actual API search parameter, and paginated with stable ordering; the Responded filter uses observed reply state.

The new status table begins at rollout; it does not fabricate historical per-location completion evidence from a client-wide timestamp. Status output does not disclose provider IDs, keys or upstream response/error bodies. A status-read failure leaves the independent inbox readable.

## Validation and rollout

Regression tests exercise complete/empty/malformed/foreign/multi-page responses, duplicate IDs, changing totals, 100-page bounds, successful/failed/stale/stalled state, overlapping imports, in-flight reply protection, legacy webhook enqueue and queue failure. Browser fixtures exercise retained data, search, page navigation, replied filtering and mobile layout. Existing authentication and provider-mapping tests remain required.

Apply migration `20260910160000_review_sync_state` using the standard deployment script. Its down migration retains status evidence. Reverting the sender does not resend anything, but reverting this importer would restore stale-webhook/partial-snapshot behavior. Compare the existing reviewed test account against the provider after rebuild, using reads only. No public replies or invitations are authorized by this release.

Remaining #206 work includes private-feedback assignment/follow-up and privacy retention/export, historical vendor-feedback coverage, deleted-source reconciliation, and approved live reply acceptance. Paid-report closeout is tracked separately in #199; Stripe remains last.
