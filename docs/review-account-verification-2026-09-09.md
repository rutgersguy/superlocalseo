# Reviewed account and vendor verification — 2026-09-09

## Account / actual reproduced failure

Normal UI and API login with the documented NerdBox test account succeeded. The account email is brent@nerdbox.com. Its EMR location is 33; production contains 8 reviews. Vendor Sources identifies the actual Google business as Light Hawk Studios, Place ID ChIJnUBk_1kP9YgRfyGuF-BkCFk, connected through that same owner email. Vendor shows 8 reviews, 5.0 average, 25% answered (2/8). Workspace naming is test configuration; no source was relinked.

The NerdBox trial is expired. Actual HTTP responses for /api/reviews, /api/integrations and /api/metrics are 402 with {success:false,error:"Your free trial has ended. Subscribe to continue.",code:"TRIAL_EXPIRED"}. The frontend expected a nested code and returned the error envelope as successful SWR data. This produced misleading no-review and connect-Google states. The shared client now handles flat/nested 402 responses, including refreshed retries, redirects to the existing access-recovery page, and throws instead of returning empty-looking data. Other unsuccessful SWR envelopes also throw. Mutation callers retain their non-402 error envelopes for inline validation. No subscription or Stripe settings changed.

Regression: node scripts/test-api-errors.cjs failed 12/14 before repair; all 14 pass after. Frontend TypeScript + production build pass. CI now runs these regressions.

## Honest-review form

No existing feedback forms were present. Created a clearly labeled QA form: QA — honest review access — 2026-09-09 (f0b195f0-679f-42d0-a705-14cfc3228beb). Vendor default STOP NEGATIVE FEEDBACK was ON at a four-star threshold. Changed OFF and saved. Google destination matches Light Hawk Studios Place ID above. Public URL: https://app.superlocalseo.com/review/nerdbox-5abd4ff5 . One-star and five-star selections both opened the same Google write-review destination; the one-star path was observed displaying Google's blank write-review dialog. No Google review or reply was posted and no invitations sent. The first-screen title is now Please share your honest experience. Keep this QA form out of customer campaigns; its workspace heading still carries the test NerdBox label.

Internal rating classification is distinct from restricting public review access. The vendor's empty-state marketing still promotes gating; every future form must be explicitly configured with filtering OFF.

## Free report

Submitted a clearly labeled owner QA request for Light Hawk Studios through /intel-request, addressed to brent@nerdbox.com. Status ID: 50fdcdb2-99e9-4e34-9e96-d2e37057084e. Generation completed. Mail confirmed both acknowledgement at 2:44 PM and report-ready delivery at 2:46 PM (local Chicago time). This run therefore took roughly two minutes; that single run does not establish a guaranteed turnaround.

Report summary and full analysis were opened. Review count 8, rating 5.0 and response rate 25% reconcile with vendor Sources and production review count. Click-gap arithmetic 1 - 1/45 = 97.78%, rounded 98%, is internally consistent, but relies on an estimated click-share model and an invalid exact-rank presentation.

Unresolved upstream defects, observed in generated report:
- Every map point is 21+ / not in the top 20, but summary presents exact rank #21. Nonappearance is not a measured 21st position.
- All 9 map points are in the lowest visibility bucket, yet that bucket displays 0% of area, rather than 100% of the 9 equally weighted sampled points.
- At a perfect 5.0 rating, advice says every extra 0.1 counts; improvement above the maximum is impossible.
- Competitor response rates/monthly volumes are labeled estimated in some sections but presented as precise facts elsewhere (e.g. 75.41% in summary).
- Signed-out prospect verification in a separate browser confirmed Show AI Visibility to the lead OFF works: AI is hidden and /full returns 404. However, the prospect gets no pin-by-pin map despite the lead page promising one. The detailed findings below were visible to the authenticated agency.
- Agency-visible full report promises instant AI replies to every customer, while our app provides drafting and explicit publishing. This would misrepresent our product if that report were shared.
- The trust-score formula, competitor selection geography, and percentage badges were not independently substantiated by the exposed report. Its methodology panel provides only generic proprietary-algorithm/benchmark disclosures. Do not certify them as accurate.
- The same report displayed 2:46 PM, then 2:50 PM, then 2:51 PM as it was reopened, suggesting the visible date is render time rather than a stable analysis timestamp.
- Black Production Films is described as top of Maps every time, but the first inspected grid point places Origin Films first and Black Production Films second.

## Vendor copy changed and limits

Previously corrected public-form hero/pills remain saved. Report Branding > Status messages provides additional supported controls. Replaced all five unsupported business-outcome headlines with neutral score bands:
A: Snapshot — score 90–100/100
B: Snapshot — score 80–89/100
C: Snapshot — score 70–79/100
D: Snapshot — score 60–69/100
F: Snapshot — score below 60/100

These replace Winning More Business / Missing Easy Wins / Costing You Customers / Bleeding Revenue Daily / Killing Your Growth. All five saved values were reload-verified; the existing report visibly changed to Your Reputation Snapshot — score below 60/100.

Inspected Public Form Page copy, Form & alerts, White-label Configuration (including Advanced), Translations and Report Branding. No semantic editor for report calculations, fixed report body or fixed lead-page timing/live-data claims is exposed in those controls. Advanced offers global script injection; no brittle page-rewriting script was installed. Vendor-owned issues require an upstream fix or a replacement report implementation. No vendor support message was sent.

Stripe acceptance remains deferred by owner instruction.
