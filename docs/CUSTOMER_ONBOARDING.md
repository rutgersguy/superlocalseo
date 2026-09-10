# Customer onboarding and operator handoff

Updated September 9, 2026. Read [current release status](RELEASE_STATUS.md) before treating this as an unrestricted self-service launch procedure. Some steps are implemented and verified locally; external owner consent, campaign delivery and multi-location acceptance remain incomplete.

## Customer journey

1. Register at SuperLocalSEO using email/password or Google sign-in. Enter business details, locations and relevant keywords in onboarding. Confirm each location belongs to the customer.
2. Launch the Google review connection from onboarding or Settings. It uses a branded EMR connect link. The customer authorizes their own Google profile; do not give them another EMR username/password as the standard workflow. Google sign-in and review-profile authorization are separate operations.
3. Use the resume/reconnect or popup fallback controls when needed. Authorization returning does not itself prove the correct business was selected; profile selection and imported review evidence are separate states. See [Google connection recovery](google-connection-recovery-2026-09-09.md).
4. Finish onboarding and inspect the dashboard's actual processing/error states. Source pulls are asynchronous. There is no guaranteed minutes-to-data or exact “Day 32” monthly-report promise. Missing or failed observations are not zero results.
5. Open Review requests → Campaign setup, select an owned location and request assisted setup. This persists one request per client/location and sends no invitations. Current requests stay “requested”; completion and customer-visible verified readiness are still #204/#207 work.
6. Continue using SuperLocalSEO for the workspace, imported reviews and available reports. Operators use EMR for remaining campaign/form configuration; customers should not need to navigate that configuration UI.

## What the operator must still do

1. Check the business identity, local location, provider organization and provider location. The current client-level EMR location does not establish correct mapping for multiple branches. Do not move or duplicate a provider resource to resolve an ambiguous failure without reconciliation.
2. Check actual provisioning state and source import. Recover ambiguous creation or partial mapping using the [recovery runbook](google-connection-recovery-2026-09-09.md); do not force database status changes or blindly rerun provisioning.
3. Open [Admin → Campaign setup](https://superlocalseo.com/admin?tab=campaign-setup). Configure the campaign and feedback form through the supported EMR UI. Campaign create/edit API parity is not established; see [capability evidence](campaign-api-capabilities-2026-09-09.md).
4. Verify the correct public Google destination, neutral invitation copy, identical public-review opportunity for every rating, optional private feedback, sender, schedule, duplicate handling and opt-outs. Copying a template or syncing a campaign is not verification. Do not enroll contacts or send invitations while provisioning.
5. Repeat destination verification on a second designated business before treating a template as reusable. Record evidence in the execution ticket until the native verification/audit workflow ships.
6. Check review import and, when explicitly authorized, delivery to a designated recipient. Provider invitation acceptance does not prove delivery; it may represent a skipped contact. Publishing replies or sending real customer invitations is not an implicit acceptance test.

## Native free-report leads

Prospects request reports at `/audit`; saved results live at `/free-report/{id}`. Operators can search them at [Admin → Free reports](https://superlocalseo.com/admin?tab=free-reports), view request/completion times and consent, inspect generation/email state and open the report. Consent is for the requested report only, not marketing.

The nine-point map samples the selected city's Census representative point. It does not use a hidden business address or measure the entire service area. The public free report is separate from authenticated monthly Reports.

The legacy EMR form and shared business-report links now route to the native flow through the versioned vendor header script. Old report links explain that a fresh request produces a new snapshot. The original vendor records remain stored.

## Billing and plan scope

Stripe activation remains last under #200. Earlier sandbox checks do not clear the later production subscription-date error or the remaining hosted webhook/browser-return acceptance checks. Do not describe activation as only flipping a switch.

Use [Pricing](PRICING.md) and the code's capability map for current Lite/Pro behavior. Plans have different feature and location entitlements; this guide does not duplicate price tables or promise access independent of billing state.

## Outstanding execution

- #196: owner consent/revocation and multi-location acceptance.
- #203/#204: reliable delivery behavior and verified per-location default campaigns.
- #205/#206: native honest-review collection/QR, private feedback and review/reply lifecycle completion.
- #207: setup verification, audit history and customer-visible readiness beyond the current request queue.
- #208: complete the external onboarding/recovery rehearsal.
- #200: final billing repair and activation.

See [release status](RELEASE_STATUS.md) for clickable tickets and exact delivered/remaining distinctions. Dated rehearsal documents preserve historical evidence rather than overriding this guide.
