# Reply publication and recovery

This #206 slice makes manual public replies durable and prevents blind retries. It does not complete review/history reconciliation, assignment, automated recovery or live owner-approved publication acceptance.

## Customer behavior

An owner or team admin opens Post to Google, reviews the exact wording and chooses **Approve and post**. The API requires explicit text (1–4096 characters); it no longer silently publishes an unapproved stored AI draft when text is omitted. Viewer accounts can read responses but cannot draft, edit, approve, publish or reconcile them. Editing a draft clears its prior approval.

Before the external call, the application commits the exact approved text, approval time, `publishing` state and provider route. A concurrent or repeated publish request is blocked while publishing, uncertain, posted or in conflict. Existing/pending replies cannot be replaced by draft regeneration or editing.

Every new attempt first reads the authoritative EMR review and verifies review ID, organization, location and supported source. An existing reply is imported instead of overwritten; a different upstream text is marked as a conflict while preserving the approved local wording. Unknown/missing upstream reply state is not treated as empty.

Only an explicit provider 200 is treated as successful publication. An ambiguous 2xx such as 202, transport timeout or unknown write failure leaves the response `uncertain`. Known refusals (402/403/404/422) or failures before the write leave it `failed`; a user may deliberately try again after fixing the cause. Every new attempt again checks the provider first.

The modal offers **Check publication status** for unresolved states. This uses only GET upstream and cannot resend. If the reply is found, local state is reconciled; if absent, uncertainty remains because absence from a possibly lagging read is not proof that a write failed. A different reply is retained in the review, and the attempted local wording remains in the response. Mapping changes after an attempt require support to reconcile the original business rather than checking a replacement mapping.

## Operations

`POST /api/reviews/:id/reconcile` is authenticated and limited to the owning team's owner/admin. It reads authoritative provider state and updates local evidence only. `GET /api/reviews/:id/response` exposes status/error/check timestamps but not credentials or internal routing records. Publication status survives refreshes and API restarts; there is no automated resend or timeout-to-retry conversion. A crash after committing publishing but before the network call intentionally requires reconciliation; an absent result remains blocked pending operator investigation.

Migration `20260910020000_reply_publication` adds nullable publication timestamps, safe error text and route provenance. Existing drafts/replies remain intact. Rollback preserves these columns and pending states. **Do not deploy older publish code against uncertain attempts**: it lacks the guard and could replay them. Disable the publish route if rolling back while retaining read/status access, and never convert pending states to drafts as a recovery shortcut.

## Validation and remaining work

Integration tests cover persisted pre-send state, concurrent duplicate calls, explicit approval text, viewer restrictions, timeouts and read-only reconciliation, changed wording, existing/foreign upstream reviews and confirmed rejection. Transport tests distinguish missing reply data from a confirmed empty reply and reject 202 as proof of publication. Browser tests simulate the uncertain API response and verify that the next action is a status check, with the text frozen and no second publication call.

No real public reply is sent by tests. Live acceptance still requires a designated review and approved reply text. Full #206 also includes scheduled reconciliation, stale/zero/partial import coverage, out-of-order events, EMR historical private-feedback coverage, assignment/follow-up state and retention/export policy. Native feedback filters and pagination were delivered with #221; this release does not claim the remaining ticket is complete.
