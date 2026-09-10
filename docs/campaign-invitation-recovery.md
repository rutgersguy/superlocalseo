# Campaign invitation tracking and recovery

SuperLocalSEO submits requests to EMR; **EMR sends email through the configured campaign**. This release adds customer history at Campaigns → Invitation request history and operator history at Admin → Invitation history (`/admin?tab=campaign-invitations`). It does not create a second mail delivery system.

## Supported workflow

Only email invitations to a verified `honest-email-v1` campaign are enabled. Phone-bearing requests are rejected until SMS/WhatsApp have their own channel verification. Bulk CSV supports at most 50 contacts; every row is validated before submission. Campaign ownership and current location/setup verification are checked before each provider write.

The browser creates a request UUID and keeps the exact payload after a lost response. **Recover same request** resumes that request without resending recorded attempts. Processing is synchronous and sequential, not a background delivery queue. A disconnected request may complete only part of a batch; recovery may submit previously unstarted contacts. A page reload loses the browser's recovery handle: inspect history first. Server-side recipient protection still applies.

## What each state means

| State | Meaning and next action |
|---|---|
| Accepted by EMR | HTTP 202 observed. This is not delivery. EMR may queue, skip duplicates, or suppress opt-outs. Allow the configured send window and inspect EMR when needed. |
| Submission unresolved | A durable attempt was saved before the external call, but no final outcome was recorded. A crash may leave this state. Do not resend. |
| Outcome unknown | A timeout, ambiguous HTTP result or failed receipt persistence prevented a reliable outcome. Do not resend. |
| Rejected or not submitted | A definite rejection or pre-send setup failure occurred. Correct contact/setup/permissions/credits, then make a deliberate new request if appropriate. Recovering the same UUID will not send again. |
| Duplicate blocked locally | No additional provider call occurred. An accepted request exists in the preceding 14 days, or an unresolved request exists. |

The 14-day guard is SuperLocalSEO's independent local policy, not a claim about a particular campaign's configured EMR duplicate window. Unresolved requests block indefinitely. No automatic resend or UI override is provided. Never delete ledger rows to force retries. Confirm ambiguous outcomes with vendor support before designing a reviewed resolution workflow.

Admin history includes the available provider reference, HTTP status, request ID, business, campaign and time. Recipient hints are masked; normalized recipient hashes support deduplication. Obtain the actual recipient from the customer when matching vendor activity. Do not expose internal route data or recipient hashes in the UI. History is scoped to the customer; admin cross-customer access requires an admin role.

Refreshing history reads our stored attempts; it does not query vendor delivery. The [documented EMR REST API](https://www.embedmyreviews.com/docs/api/) exposes invitation submission but no per-invitation delivery lookup. Operator inspection of the correct business/campaign in EMR remains necessary for delivery investigations. Historic EMR sends and sends outside SuperLocalSEO are not backfilled into this ledger.

## Metrics and operational limits

Campaign pagination is bounded and organization-scoped. Absent or invalid statistics remain null; old cached zero defaults remain unknown until a fresh provider read. The UI shows counts without inferred conversion percentages. Provider review actions do not establish confirmed public reviews or delivery.

Migration `20260910030000_campaign_invitations` retains its tables on rollback. Do not roll the application back to a sender that bypasses these safeguards while invitations remain enabled. There is no queue worker or automatic recovery sender in this release.

## Acceptance

Automated coverage checks durable pre-send records, concurrent/repeated request IDs, payload conflicts, recipient duplication, unknown-outcome blocking, deliberate rejection recovery, tenant isolation, input limits, status receipts, and campaign pagination. Browser checks simulate outbound responses; no real invitations are sent. Actual destination, send-window, opt-out and permitted delivery acceptance still require the designated owner-controlled pilot. This does not close all of #203 or #207.
