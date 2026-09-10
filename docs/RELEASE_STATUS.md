# Commercial release status

Updated September 10, 2026. Invitation tracking and recovery are described in [the recovery runbook](campaign-invitation-recovery.md); deployment acceptance is recorded on the implementation PR. Previously deployed: [reply recovery #222](https://github.com/rutgersguy/superlocalseo/pull/222), [native collection #221](https://github.com/rutgersguy/superlocalseo/pull/221), and [provider routing #220](https://github.com/rutgersguy/superlocalseo/pull/220). This is the current status index; dated investigation documents preserve earlier observations and are not current launch checklists.

**The remaining work is not just reporting or status checks.** The native acquisition report and its admin listing are live. Campaign provisioning/verification, native collection and private-feedback workflows, review/reply reliability, multi-location onboarding, and external acceptance testing still have unfinished scope. Unrestricted self-service commercial readiness has not been demonstrated. Stripe stays last, including a known subscription-date defect rather than only switching on payments.

## Recovery, feedback and claims release — PR #226

[PR #226](https://github.com/rutgersguy/superlocalseo/pull/226) combines [acquisition-report recovery](free-report-recovery.md), [private-feedback follow-up](private-feedback-follow-up.md), and [report/website claim corrections](report-claims-audit.md). Recovery preserves paid scan progress and blocks unknown email outcomes; feedback adds local assignment, status and notes plus protected Pro exports. These changes do not remove the owner-onboarding and vendor-delivery acceptance work below. Deployment and browser acceptance are recorded on the PR.

The isolated full backend suite passed **475 tests in 48 suites**. Backend/frontend builds and all backend test-file compilation passed. Existing PDFs and native snapshots are checked for preservation before and after deployment. No live invitation, public reply, email recovery or charge is used as a release smoke test.

## Work in progress: provider mapping

The registry and operator inspection workflow are implemented. The routing follow-up uses explicit mappings for EMR location operations and adds a VA guide in the admin screen. Storage, conflict protections, history and an admin screen are implemented. Mapping saves now use an explicit operator Google-source inspection plus API-verified organization membership; automatic Google identity verification remains unavailable. Live inventory found three local locations with correct legacy EMR membership but no saved Google Place IDs. The inspection follow-up is validated separately from the original registry release; deployment evidence is recorded in its GitHub release comments. No production customer mappings have been saved by this work. The legacy review-testing fixture remains unchanged. See [routing scope and limits](provider-routing.md). See the [implementation and activation checklist](provider-location-mappings.md).

## What is live and verified

| Area | Delivered behavior | Evidence and limits |
|---|---|---|
| Native free report | Homepage → `/audit`; exact business selection, city and keyword sample, immutable source timestamps, review totals, honest found/not-found/unavailable calculations, report-only email consent, saved report link and print/PDF | [#211](https://github.com/rutgersguy/superlocalseo/pull/211), [#212](https://github.com/rutgersguy/superlocalseo/pull/212). Uses DataForSEO observations and Census city centers. Does not estimate traffic/revenue or claim citywide coverage. Production schema drift repaired without changing historical leads. |
| Geographic report display | Nine stored coordinates on a street map, translucent markers with adjustable opacity, labeled sample center, point inspection, mobile and print layouts | [#213](https://github.com/rutgersguy/superlocalseo/pull/213). Center is the selected city's Census representative point, not a hidden business address. Viewing does not purchase a new scan. |
| Admin free-report leads | [Admin → Free reports](https://superlocalseo.com/admin?tab=free-reports): search, pagination, report links, processing/email status, consent details, attention filter | [#214](https://github.com/rutgersguy/superlocalseo/pull/214). Admin recovery now resumes only eligible saved requests; active jobs and unknown email outcomes block retries. See [recovery runbook](free-report-recovery.md). Email accepted means provider acceptance, not delivery/opening. Legacy vendor leads are excluded. |
| Legacy public report links | EMR `/intel-request` routes to the native builder; existing `/business-report/{token}` links show a native migration notice before a new request | [#215](https://github.com/rutgersguy/superlocalseo/pull/215). Installed the versioned header snippet in the signed-in EMR UI. Anonymous checks passed for the form and all three existing shared reports; login preserved. Client-side routing, not an HTTP redirect. Vendor records remain intact. |
| Google connection recovery | Shared onboarding/Settings connection UI, resume/reconnect, popup fallback, bounded status polling, scoped import and safer provisioning retries | [#210](https://github.com/rutgersguy/superlocalseo/pull/210). Provider simulation/browser checks passed. Full owner consent/revocation and multi-location mapping remain open. Connection history is not proof of current credential health. |
| Assisted campaign requests | Customer selects an owned location and saves one idempotent setup request; [Admin → Campaign setup](https://superlocalseo.com/admin?tab=campaign-setup) lists requests and synced campaigns | [#209](https://github.com/rutgersguy/superlocalseo/pull/209). Unsupported provider template/credit/unsubscribe endpoints are reported as unavailable. A synced campaign is not verified readiness or delivery. The verification workflow now adds operator updates, audit history and customer configuration status; see [verification runbook](campaign-setup-verification.md). It does not provision campaigns or establish delivery. |
| Review account evidence | A scoped connected account reconciled eight Google reviews and two replies; access/error handling repaired | [Review-account verification](review-account-verification-2026-09-09.md). One reconciled dataset does not establish the complete sync, reply, or private-feedback lifecycle. |

## Remaining ticket scope

These are scope statuses, not a claim that issue checkboxes or closure imply live acceptance.

| Ticket | Current status | Work still required |
|---|---|---|
| [#196](https://github.com/rutgersguy/superlocalseo/issues/196) Google onboarding/recovery | Partially delivered | Owner-controlled consent, selection, revocation/reconnect acceptance; explicit multi-location mappings and safe reconciliation of ambiguous provisioning. |
| [#199](https://github.com/rutgersguy/superlocalseo/issues/199) Native verified reports | Native acquisition and legacy routing delivered | [Monthly PDF/email recovery](monthly-report-recovery.md) now reuses generated files, records delivery acceptance separately, blocks ambiguous resends and restricts generation to the signed-in workspace. Final paid-report/website claims audit and acquisition stuck-job recovery remain; automatic operator recovery is not included. Paid monthly reports remain a separate flow. Vendor calculations were replaced in acquisition, not repaired upstream. |
| [#203](https://github.com/rutgersguy/superlocalseo/issues/203) Campaign API and send behavior | Partially delivered | Durable invitation attempts, same-request recovery, recipient duplicate guards, customer/admin history and unknown metrics are implemented; see [invitation recovery](campaign-invitation-recovery.md). Controlled delivery/destination/opt-out validation and vendor-assisted resolution remain. Vendor acceptance, including a skipped contact, is not proof of delivery. |
| [#204](https://github.com/rutgersguy/superlocalseo/issues/204) Safe default campaigns | Not completed | Manual honest-email-v1 checklist and verification evidence are implemented. Still required: actual vendor configuration, two-business destination/delivery pilot and supported idempotent provisioning. No automatic template application enabled. |
| [#205](https://github.com/rutgersguy/superlocalseo/issues/205) Native collection and QR | Native direct-sharing flow implemented; channel acceptance pending | Campaigns now provides verified-location native links and downloadable QR codes, optional private feedback, equal Google access for all ratings, revocation/replacement, input and spam controls, and tenant isolation. Private feedback has location/rating filters and pagination. Existing vendor campaign destinations remain unchanged until channel compatibility is verified. See [runbook](native-review-collection.md). |
| [#206](https://github.com/rutgersguy/superlocalseo/issues/206) Reviews and private feedback | Existing foundation; ticket incomplete | [Bounded source snapshots, overlapping-import protection, webhook reconciliation and inbox health](review-sync-reliability.md) are implemented. Remaining: feedback follow-up/privacy workflows, deleted-source reconciliation and reply lifecycle acceptance (durable publishing and manual read-only timeout reconciliation are implemented in PR #222), native feedback integration and truthful vendor history coverage. No live public reply test has been implicitly authorized. |
| [#207](https://github.com/rutgersguy/superlocalseo/issues/207) Onboarding operations | Configuration workflow implemented | Completion/blocking/reopening controls, audit history and customer configuration status are implemented in this revision. Remaining: multi-location mapping, broader recovery and external acceptance. Admin report listing, campaign verification, provider mapping and invitation history are live; broader recovery remains incomplete. |
| [#208](https://github.com/rutgersguy/superlocalseo/issues/208) Release rehearsal | Partial evidence | Rehearse the actual owner-controlled onboarding, connections, two-business campaign destinations, permitted delivery, feedback and recovery flows. Local tests do not replace external acceptance. |
| [#200](https://github.com/rutgersguy/superlocalseo/issues/200) Stripe | Deferred to last | Repair the production subscription-period NaN timestamp error recorded September 9; validate event payload/version, ordering and retry safety; complete browser return and real hosted webhook delivery before live activation. Earlier sandbox successes do not clear the later defect. |

## Execution order

1. Pilot the implemented campaign verification/readiness and audit workflow with actual vendor configuration (#204/#207); do not mark real campaigns verified without inspection.
2. Verify residual vendor campaign configuration on two designated businesses. Confirm the channel can target native collection before claiming the vendor UI has been eliminated (#203/#204).
3. Pilot native collection/QR and private-feedback management; finish review/reply synchronization and recovery (#205/#206).
4. Complete owner consent and multi-location acceptance, then the end-to-end onboarding rehearsal (#196/#208).
5. Repair and validate billing, then activate Stripe (#200).

## Manual work when a customer onboards today

- Confirm owned business/location identities and the intended provider organization/location mapping. Do not assume a client-level provider location represents every branch.
- The owner authorizes Google through the branded connect-link flow launched in our app. A separate EMR username/password is not the intended customer journey.
- An operator still configures/verifies the campaign and feedback form in EMR: business-specific Google destination, neutral invitation, identical public access at all ratings, optional private feedback, sender, schedule, duplicate window and opt-out behavior.
- Verify the synced campaign corresponds to that location. Use the setup verification form after inspection; it records the operator attestation and preserves history. Multi-location verification requires a current explicit provider mapping and a campaign verified for that branch.
- Check actual source import and permitted delivery evidence. Do not send real customer invitations, publish replies, or enroll contacts as an implicit setup test.

EMR still supplies approved Google review connectivity, review ingestion/replies and campaign delivery. SuperLocalSEO owns the native report, customer workspace and operations screens. Campaign/form configuration is the main remaining operator use of EMR's UI; API parity for that configuration has not been established.

## Latest verification evidence

- Latest full backend run: **475 tests in 48 suites passed** for PR #226. This is a repository test count, not live customer journeys. The new inbox and reply-recovery browser checks passed; the strict reader reconciled eight live test-account reviews and two replies with no differences. Deployment evidence is recorded on the implementation PR.
- Native-report browser suite: **three checks passed** on the final routing change; admin browser workflow passed on its release. Mobile/print map visuals were inspected during #213.
- All five required GitHub checks passed before each of #211–#215 was merged. Production rebuilds used `scripts/deploy.sh`; latest deploy returned site 200, API 422 validation, and zero startup errors.
- Owner QA report: [Light Hawk Studios](https://superlocalseo.com/free-report/ef0896d9-64b0-4ace-86a3-57b11146d0db). Eight reviews, rating 5.0, nine usable checks, no exact listing match among the 20 results at each point; average rank remains unknown. Provider receipt confirmed delivery of the owner-requested report email; opening/inbox placement is not inferred.
- A normal production admin login found that report through the new listing and exact-ID search. Signed-out legacy link tests performed no report generation.
- No campaign invitations, public review replies, or live card charges were sent as part of these report releases.

Detailed evidence: [native reports](native-free-reports-2026-09-09.md), [Google recovery](google-connection-recovery-2026-09-09.md), [campaign API boundaries](campaign-api-capabilities-2026-09-09.md), [earlier rehearsal](release-rehearsal-2026-09-09.md). Rollback of legacy routing removes only `integrations/embedmyreviews/report-routing.html` from EMR Header Scripts; retain native reports and vendor records.

Campaign verification implementation details: [operator runbook](campaign-setup-verification.md). This revision adds configuration attestation, not automatic provisioning or proof of live delivery. Release validation is recorded on #204/#207.

Reply publication now has durable pending/uncertain state, owner/admin approval, upstream identity checks and a read-only status check without resending. See [reply recovery](reply-publication-recovery.md). Live public-write acceptance and broader #206 lifecycle work remain pending.
