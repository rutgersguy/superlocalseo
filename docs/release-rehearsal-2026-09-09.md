# Release rehearsal — 2026-09-09

Base: deployed GitHub main dc0a716. This rehearsal is incomplete because the password-authenticated SSH control session expired. Fresh origin/server synchronization, isolated integration testing, Stripe test-mode testing and deployment must resume after reconnection. Do not treat local passes as end-to-end checkout verification.

## Reproduced failures

1. Live campaign creation: in the intentionally unconnected Aire Serv test account, New Campaign → name `Release QA — no invitations — 2026-09-09` → Create Campaign returns an error that campaign creation is unavailable through the API. The modal was closed. No contacts were supplied and no invitations were sent. Current vendor REST docs document listing campaigns and sending invitations, not campaign creation: https://www.embedmyreviews.com/docs/api/ . The supported setup must be verified through the vendor dashboard; the current app button is a dead end.
2. Delayed invoice event: the actual Stripe webhook handler with isolated database/provider fixtures changed a canceled subscription back to active after receiving an old invoice.payment_succeeded event, even though the provider lookup returned canceled. The local repair only grants access for an active provider subscription whose latest invoice matches the event invoice. Lookup failures now propagate for retry instead of granting access. Both invoice.paid and invoice.payment_succeeded are covered, alongside canceled/past_due/unpaid/paused/incomplete_expired statuses and an old invoice preceding a newer unpaid upgrade.

## Tests completed

- Original cancellation regression failed before the change (expected canceled, actual active) and passed after (actual canceled).
- Nine new billing-event-order regression tests passed.
- All 199 local unit tests across 14 suites passed.
- Backend TypeScript build and git diff --check passed.
- Live integration screen still shows two Google Business Profile cards: direct connection to a visible location named SuperLocalSEO, and a separate review connection marked not connected. This is intentionally test data, but the confusing customer-facing connection flow remains.
- Live billing screen renders; no real checkout, payment or cancellation was attempted.

## Still required

- Sync with origin and the canonical server checkout; apply and test the patch there, then merge/push/deploy through GitHub.
- Run the isolated PostgreSQL/Redis/API/web stack and complete Stripe test-mode checkout, webhook delivery, failure, cancellation and entitlement checks. Inspect test credentials without printing secrets. Existing billing verification scripts call handlers directly and do not alone establish HTTP webhook delivery.
- Verify a supported, tenant-scoped campaign setup and matching destination for two controlled accounts; test equal public-review opportunities at low and high ratings. Vendor documentation says the unhappy path can be disabled: https://www.embedmyreviews.com/features/feedback-forms/ . Documentation is not a substitute for observing the configured form.
- Verify the intended Google business identity and review reply path using an owner-approved controlled profile. Do not publish a live review reply without explicit authorization.
- Complete free-report delivery and signup/onboarding using a controlled inbox and test account; no report-request or signup submission was performed in this partial rehearsal.

No cards were charged, review replies published, customer messages sent, or existing integrations changed.
