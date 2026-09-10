# Campaign setup verification and readiness

Implementation slice for #204/#207. This adds operator controls and customer-visible configuration status; it does not create vendor campaigns, send invitations, or complete the two-business vendor delivery pilot.

## Customer and operator workflow

Customers request assisted setup under Review requests → Campaign setup. Admins open `/admin?tab=campaign-setup`, expand **Update setup / record verification**, and record in-progress, blocked, reopened, or verified status with an internal note. Existing requests default to requested; none are backfilled as verified.

Verification is an operator attestation of email configuration at a recorded time, not a delivery guarantee. The form requires a campaign synced to the customer, confirmation of the location's saved Google place ID, and every checklist item. The preview destination is built from that saved place ID, never an arbitrary redirect input. Setup writes do not call EMR, enqueue provider jobs, enroll contacts or send messages. Customer reads omit internal notes, operator identifiers and provider mapping evidence.

The first scope supports one location per customer. Multiple local branches remain blocked from verification until explicit branch/provider mapping is delivered under #196. Missing or shared provider IDs also block verification. Do not bypass these checks by changing database state to make the form accept a request.

## Manual template: honest-email-v1

Apply through supported vendor configuration, then inspect it before recording verification:

- Subject: “How was your experience with [Business name]?”
- Invitation: “Thank you for choosing [Business name]. Please share an honest review of your experience. Your feedback helps us improve and helps others decide whether we are right for them.”
- Public action: “Leave an honest review”, using this business's confirmed Google destination with the same access and prominence for every rating.
- Optional action: private feedback, clearly labeled and never a prerequisite for the public link.
- Sender/reply-to: verified business-specific details; do not copy another business's identity.
- Configure opt-outs and the provider's duplicate window. Start with one email and no automated follow-up; document any later schedule change and re-verify. SMS is outside this checklist.
- Applying configuration must not enroll contacts or send messages. Live delivery testing requires a separately authorized designated recipient.

The version identifies this manual configuration/checklist. Saving verification does not apply this template in EMR. There is no broad automatic application or mutation of existing campaigns.

## Evidence and recovery

Every successful change atomically increments a revision and appends an audit event with actor, timestamp, note and verification evidence. Two operators cannot overwrite the same revision: the second save receives 409 and must refresh. An ambiguous save retry also receives a conflict rather than adding duplicate history. Reopening clears current verification but retains earlier audit events.

Verification binds to the local business identity/address/place ID, provider organization/location, and synced campaign identity/name. Later local changes, a missing campaign, or an additional location cause customer/admin reads to show needs re-verification. Changes made only inside EMR are not automatically detected; operators must reopen and inspect after such changes. This is not continuous external monitoring.

For blocked setup, record the missing mapping/configuration and resolve it through the supported flow. Do not mark verified merely because a campaign appeared after sync. Customer wording distinguishes requested, in progress, blocked, verified configuration, and needs re-verification. No internal note is exposed as a customer explanation.

## Validation and rollout

Integration coverage includes admin authorization, tenant-bound campaigns, wrong place IDs, required checks, revision conflicts/concurrent saves, preserved audit history, multi-location rejection, and changed-destination readiness. Browser coverage exercises invalid and valid verification, the history, mobile layout and customer status/re-verification using isolated fixtures. No real public review is submitted and no invitation is sent in these checks.

Migration `20260909020000_campaign_setup_verification` adds status/revision/evidence to setup requests and a separate event table. Deploy using `scripts/deploy.sh --migrate`. Rollback application code while preserving these additive columns/events; migration down intentionally retains operator evidence. The two-business live vendor pilot and complete delivery/opt-out validation remain #203/#204/#208 acceptance work.
