# Release rehearsal — 2026-09-09

This is an assisted-pilot release rehearsal, not evidence that every external customer journey is ready. Started from GitHub main dc0a716 after verifying origin and server agreed. Application changes are being merged/deployed through GitHub. Vendor settings are separately recorded in vendor-public-form-copy-2026-09-09.md.

## Repairs found by testing

- Paid-invoice events now reconcile against the current Stripe subscription and latest invoice. Old payments cannot restore canceled access or grant a newer unpaid upgrade.
- Failed-invoice events reconcile current subscription/invoice state. A delayed failure cannot revoke access after payment recovery or override a canceled subscription.
- Mounted Express billing routes remain accessible after cancellation, trial expiry or the payment-failure grace period. Protected customer data still returns 402.
- Checkout offers Lite/Pro selection. Client-row locking serializes replacement checkout intents; superseded incomplete subscriptions are canceled, while an existing active or delinquent subscription cannot be duplicated. Customers with an existing subscription are directed to billing settings.
- Stripe Payment Element collects its required country field; thrown submission errors release the processing state. The Stripe instance is memoized, plan changes remount Elements, and the return page no longer declares access active from a URL parameter alone.
- The failing campaign-creation form is replaced by explicit assisted setup. Legacy POST callers receive CAMPAIGN_SETUP_REQUIRED without an unsupported agency-scoped vendor write. This does not implement self-service campaign provisioning.
- Rankings now count filtered observations consistently with the label and table; keywords awaiting their first scan are not observations. Geo-grid selectors have accessible names. Lite no longer shows an empty export accordion.
- Checkout ROI copy describes scenarios rather than revenue attribution. Editable vendor lead-form copy no longer claims 100+ customers or guaranteed freshness/timing.

## Validation

- 286 backend tests in 26 suites passed against an isolated PostgreSQL database and disposable Redis instance; TypeScript builds passed.
- scripts/verify-billing-http.cjs passed 18 checks using real Stripe sandbox prices, subscriptions, invoices and test-card confirmations. Covers Lite $149 with no setup fee, switching unpaid checkout plans, concurrent checkout requests, duplicate-subscription prevention, Pro upgrade, invalid signatures, duplicate/delayed events, cancellation, declined payment, grace-period access, billing recovery and successful retry.
- The billing script delivers locally signed representative events over HTTP to the isolated API. It verifies signature parsing and handler behavior but does not prove Stripe-hosted endpoint network delivery.
- Browser regression suite exercised signup/login, onboarding/skip/resume, dashboard navigation, plan gates, empty data, pricing, rank calculations, map error feedback and citation states. Stale pre-redesign labels were updated. Final results are recorded in the deployment verification addendum.
- CUA inspection of the actual Stripe test-mode iframe verified that the country field is now present and both checkout plans are offered. The initial submission stayed in Processing. After truthfully selecting Stripe's AI-agent checkbox, Stripe presented a separate Link Pay Token flow. No Link account was enrolled and no browser payment completion is claimed; SDK sandbox confirmations are covered by the 18-check script.
- Campaign assisted-setup dialog was inspected in the browser. Two-client campaign-list isolation and the legacy 501 response passed real API/database tests.
- Public report business lookup reached the contact step. No report email, review invite, review reply or prospect message was sent. No live card was charged.

## Remaining acceptance checks before unrestricted self-service launch

1. Verify one owner-approved Google profile and both review connection paths end to end. The Aire Serv account is intentional test data; NerdBox's reviews mention LightHawk and need identity confirmation, not automatic relinking (#196).
2. Configure the first correctly scoped vendor feedback form/campaign, disable rating-based restriction of public-review access, and observe equal public-review choices at low/high ratings. Repeat with a second controlled tenant to verify vendor-side routing (#198). Local API isolation tests do not prove vendor form configuration.
3. Complete browser payment/return and actual Stripe-hosted webhook delivery to the intended environment (#200). Test-card SDK success is not the same as this external delivery check.
4. Use an owner-controlled inbox to request and inspect the vendor free report and email. The form also consents to follow-ups. Remaining non-editable vendor claims require correction or substantiation (#199). These free reports are separate from the backend monthly PDFs repaired earlier.

## Running the billing test

Rebuild and start only the isolated test api/web services with docker-compose.test.yml. Copy the versioned script into slseo-test-api and run it with node. It asserts NODE_ENV=test, a superlocalseo_test database, sk_test credentials, and placeholder email credentials before writing. It removes its unique user and Stripe customer/subscriptions in finally. Never run it against production or replace test credentials with live keys.

The test stack pre-existed this rehearsal. Temporary unit-test Redis/database, SSH forwarding and the browser checkout fixture are cleaned up after validation. Production deployment uses scripts/deploy.sh, a verified database backup, and api/web-only recreation with --no-deps; shared database/Redis services are not restarted.
