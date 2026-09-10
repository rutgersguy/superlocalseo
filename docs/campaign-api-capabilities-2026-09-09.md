# Campaign API boundaries and assisted setup

Execution slice for #203 and #207. This does not complete either ticket, enable automatic templates, or prove campaign delivery.

## Provider evidence

Reference: https://www.embedmyreviews.com/docs/api/ (checked September 9, 2026).

| Operation | Current support / evidence | Implementation |
|---|---|---|
| List campaigns | Documented GET /api/v1/request-reviews/campaigns, organization_id scope. First live scoped probe returned 429, not an empty list. | Existing scoped sync; further live verification pending. |
| Send invitation | Documented POST /api/v1/request-reviews/campaigns/{uuid}/invite. No invitation sent during this probe. | Existing send path; 202 is acceptance, not delivery. |
| Create/edit campaign, sender, schedule, form destination | No corresponding REST operation in current reference | Assisted configuration; do not use dashboard session endpoints. |
| Template list | Existing helper GET /api/v1/request-reviews/campaign-templates returned 404 | Removed unsupported helper; local endpoint marks unavailable. |
| Unsubscribe list | Existing helper GET /api/v1/request-reviews/unsubscribes returned 404 | Removed helper and doomed preflight; local endpoint marks unavailable, not zero. |
| Credit balance | Existing helper GET /api/v1/account/credits returned 404 | Removed helper; balances are null and available=false. |
| Opt-out and duplicate handling | Documentation says invitation endpoint respects opt-outs and configured campaign duplicate window (default 14 days) | Provider enforced. Acceptance cannot establish a send, because a skipped contact also receives 202. Live controlled delivery still required. |
| Contact activity/private feedback | MCP documents these read tools with separate permissions | Not wired or verified in this slice; do not imply API parity. |

## New request workflow

Campaign setup in our app selects an owned business location and POSTs /api/campaigns/setup. Unique (client_id, location_id) makes retries idempotent. No vendor resource or message is created. GET returns only the current client's locations and requests.

Internal Admin → Campaign setup lists requests and existing synced campaigns, with client-level provider organization/location IDs. This first slice is read-only: a synced campaign is not a verified location destination, and a request stays recorded. Completion attestation, template versioning, automatic application and retry controls remain #204/#207 work.

## Manual operator checklist

1. Match requested business and local location to the intended provider organization. Multiple local branches require explicit mapping; the client-level provider location must not be assumed to represent every branch.
2. Configure the neutral invitation, correct sender and public feedback destination in EMR. Do not create customer sub-accounts or give customers another login.
3. Verify the Google place ID belongs to this business. Check every rating path gives the same public-review opportunity; private feedback is optional.
4. Check configured send window, duplicate handling and opt-out behavior using designated internal recipients only when a delivery rehearsal is authorized. Do not enroll customer contacts during setup.
5. Confirm campaign sync to this client. A 202 request response is not proof of delivery or a posted review.

## Deployment and limits

Migration 20260909000000 creates a new request table with cascading client/location ownership and a unique location request. No backfill and no changes to existing campaigns or contacts. Apply with the repository deployment script's --migrate option. Roll back application code while retaining request records; schema rollback drops those records and should only follow an export.

Legacy POST /campaigns remains an explicit 501 for old callers. The new customer flow uses /campaigns/setup. The compatibility `sent` response property remains temporarily, with `accepted` and deliveryConfirmed=false added; current UI labels these as accepted requests. Durable per-request send reconciliation and stricter campaign metrics still remain in #203.

## Verification for this slice

- Backend TypeScript build and frontend production build passed.
- Fresh isolated PostgreSQL database: all 44 migrations applied; Jest passed 291 tests in 27 suites, including five setup-request tests.
- Isolated Docker API/web rebuilt and migrated; Playwright customer → saved request → reload → admin queue journey passed (1 test). No vendor sends or real customer mutations.
- `git diff --check` and deployment preflight passed.
- Initial test run failed because macOS archive metadata appeared as a migration file. Transfer metadata was removed; the clean migration and complete rerun passed. No production migrations ran during that failure.

## Current completion boundary

The setup queue now includes operator status updates, versioned email-configuration attestation, a revisioned audit history and customer-visible configuration status. See [verification runbook](campaign-setup-verification.md). This does not supply a campaign create/edit API, automatic template application, live delivery verification or multi-location mapping. Earlier read-only descriptions above record the initial #209 slice. See [release status](RELEASE_STATUS.md) for remaining work.
