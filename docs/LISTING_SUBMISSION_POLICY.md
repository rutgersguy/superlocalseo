# Paid listing submissions

Approved 2026-09-15. This supersedes older references to broad 40+ directory submission packages or a manual-first fallback.

## Monthly operation — lower-cost policy approved 2026-09-15

Automatic listing checks run on the first of each month at 07:00 UTC for active Pro accounts. This replaces the weekly recurring scan; scoped initial onboarding scans remain available during trial. The worker removes the previous daily and weekly schedules when registering the monthly schedule. A check flags findings for review and never calls the paid Citation Builder confirmation endpoint.

The included submission allowance remains one initial campaign capped at 15 credits per paid location. There is no monthly credit refill or automatic paid repeat submission. Later paid work requires a separately authorized and paid add-on. That follow-up ordering/billing flow is not implemented yet; no promise of automatic monthly submissions is made in the UI. VAs continue to approve the initial order. The Business Listings screen states the schedule and distinction explicitly.

## Customer promise

Pro includes one initial listing campaign per paid location, capped at 15 Citation Builder credits. It is not a monthly allowance. Trial users can review audits and prepare their details, but no submission spending occurs during a trial. Submission requires confirmed business details and a successful non-zero Pro subscription payment. Payment does not automatically order listings: the operator reviews and confirms the prepared campaign.

Audit coverage and submission eligibility are different. The registry provides 10 core directories plus relevant industry directories. The submission list is the intersection of this curated set and BrightLocal's completed lookup of available directories. An audited directory is not a promise that BrightLocal can submit to it. Already correct listings should be left alone. Missing search evidence alone is not proof a new listing is needed: verify before creating a duplicate.

Personal Training and Gym / Fitness Studio use the core directory set. They do not inherit physician directories from the broader Health & Fitness group. Fitness-specific additions require a reviewed registry change; do not pad campaigns with unrelated sites.

## Credits and packages

The included order supports cb10 or cb15 only, reserving 10 or 15 credits respectively. The full package allocation is reserved even when fewer directories are selected; do not advertise a per-selected-row discount. There is one initial campaign, not a reusable monthly balance. Unused capacity is not automatically redeemed through another campaign. Where fewer suitable directories exist, submit fewer; never add irrelevant sites to fill a package.

Aggregators, expedited service, automatic directory selection, duplicate-removal services and larger packages are blocked. These need a separately priced and explicitly authorized future product flow, not an admin bypass. No such extras checkout is implemented.

BrightLocal credit documentation: https://help.brightlocal.com/hc/en-us/articles/360036448574-What-do-I-need-credits-for-and-how-do-they-work
Management API: https://developer.brightlocal.com/docs/management-apis/agjq3z0pfs6nk-citation-builder

## Enforcement and recovery

Both tenant and admin confirmation routes call the same spending service. It checks tenant/location ownership, Pro eligibility, the current Stripe subscription and latest invoice, positive payment, campaign ownership, completed lookup, directory relevance and package constraints. Production requires a live-mode invoice. An active flag, a zero-value invoice, an out-of-band invoice or trial expiration cannot unlock submissions. A latest invoice that cannot prove payment blocks spending; no inferred grandfathering.

A durable citation_orders row reserves the location's single initial order before the paid provider call. Concurrent confirmations cannot create a second order. Successful same-campaign retries return without purchasing again. Existing pre-policy submission history blocks a new automatic allocation and requires review.

An uncertain provider response or local persistence failure leaves the allocation reserved as needs_review. A process crash may leave submitting. Do not delete reservations or blindly retry. Inspect the BrightLocal campaign and reconcile its actual acceptance and citation statuses before any operator recovery. The initial implementation intentionally has no automatic paid retry or reset endpoint. Financial order records prevent deletion of their associated client/location until retention is explicitly handled.

## Operator workflow

1. During trial, confirm the business's name, address/service area, phone, website and industry with the owner; review existing listings.
2. After a paid Pro subscription, prepare the location's BrightLocal campaign and wait for lookup completion.
3. Select only relevant available directories needing creation or correction. Review the package credit allocation. No directory or aggregator is preselected.
4. Confirm business details and listing need in the wizard, then submit once. Stripe eligibility is checked again by the server.
5. Track acceptance and progress in the submissions table. Provider acceptance is not proof that a listing is live; verification may still require the owner.

## Related work

The DataForSEO website crawler and integrated audit presentation remain a separate, unfinished implementation. This submission policy does not mark that request complete.
