# Report and website claims audit — September 10, 2026

Implementation: PR #226. The full isolated backend suite passed 475 tests across 48 suites. See the PR acceptance comment for final browser, GitHub and production verification.

## Corrections

- Traffic scenarios exclude unsupported Google result types and invalid ranks instead of applying the organic CTR curve to them. Missing/invalid volumes remain unavailable. Invalid conversion/customer-value settings cannot become negative or non-finite estimates. A genuine zero conversion rate remains zero. These estimates are modeled scenarios, not measured traffic or revenue.
- Monthly recommendations ask users to inspect the matching keyword, area, result type and source evidence. Rank averages and audit scores do not diagnose a need for link building or explain why an assistant omitted a business.
- Citation coverage explicitly shows listed / verified location-directory checks, excludes unverified checks, and gives the separate readable NAP denominator. Six failed checks across branches do not necessarily mean six different directories. Saved checks may predate the reporting month.
- The landing-page preview explains which example visuals are dashboard features rather than promising that the monthly PDF contains maps and trend charts. Monthly email submission is distinguished from guaranteed delivery.
- The unused legacy Audit component no longer claims daily citation checks or proven causes of ranking changes. The active public `/audit` route uses FreeReport.
- Monthly worker fan-out selects the prior UTC month consistently with report validation, even if the host timezone changes.

## Source reconciliation

| Claim | Code evidence | Limit |
|---|---|---|
| Daily rankings | daily-pull schedule in backend/src/jobs/queue.ts | Requires configured keywords, eligible account and successful upstream checks. |
| Weekly citations | weekly-scan Monday schedule in queue.ts | Pro capability; unmatched and unavailable checks are separate. |
| Weekly AI samples | weekly-scan Monday schedule in queue.ts | Sampled API answers, not measured customer exposure. |
| Monthly reports | first-of-month reports worker in queue.ts | Generated from collected data; missing sources cannot be invented. Email acceptance is not delivery. |
| Historical ROI | gatherReportData sets roi to null | Historical volumes/configuration are not versioned; present assumptions must not be inserted into prior months. |
| Review totals | publication-date-filtered stored review rows | Imported subset, not proof of a complete Google profile history. |

## Validation

Local backend unit suite: 291 tests across 22 suites passed. Backend and frontend type checks passed. Regression coverage includes invalid/unsupported observations, missing inputs versus true zero, conservative report recommendations, and Lite section gating. The combined database suite subsequently passed 475 tests across 48 suites; browser and deployment acceptance are recorded separately on PR #226.

Existing live datasets and PDF files must remain intact. Do not regenerate customer PDFs or send email as a verification shortcut. Continue the read-only reconciliation used for PR #225 after deployment.
