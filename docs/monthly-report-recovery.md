# Monthly report generation and email recovery

The monthly report generator now separates creating a PDF from submitting its email. A saved PDF is reused for subsequent requests for that customer and month; it is not regenerated or overwritten merely because a browser/worker retries. Generation claims are serialized in Postgres. A generation older than 15 minutes can be claimed again, with a new token and file path. A late abandoned worker cannot attach or email its obsolete result.

The generation API only accepts the signed-in workspace. A foreign clientId is rejected before queueing; month/year must be integers within a completed UTC month. Current-month drafts are not finalized early and then accidentally reused as the completed monthly report. Background jobs validate their periods too. Generation does not purchase new rank scans; it renders existing observations using the existing verified report formulas and plan gates.

## Email states

| State | Meaning |
|---|---|
| Not submitted | A tracked PDF can be submitted on processing this period. |
| Sending/unresolved | Submission was recorded before the external call; its final result is not known. Do not resend. |
| Accepted | Resend returned a provider receipt. This does not establish inbox delivery. |
| Rejected | A definite provider rejection or pre-send file failure occurred. Correct the cause and request the same period to retry the original saved PDF/recipient. |
| Uncertain | A timeout, ambiguous response, missing receipt or failed final persistence occurred. Do not resend; inspect provider activity. |
| Historical outcome unverified | Legacy reports have no trustworthy receipt evidence. Preserve their files and historical sent_at without asserting verified delivery or resending them. |

PDF generation status remains independent. Mail failures do not delete the generated file or label the PDF itself failed. Reports → Report status and recovery explains these states. Available reports retain preview/download controls. A stalled generation can be recovered through Generate report for the same period.

New requests send a stable HTTP Idempotency-Key tied to the report UUID. [Resend retains those keys for 24 hours](https://resend.com/docs/dashboard/emails/idempotency-keys); our durable ledger blocks accepted, sending, uncertain and legacy attempts beyond that window. There is no automatic unknown-outcome resend. Before retrying a definite rejection, the saved attachment hash is checked and the original recipient and period are reused. Altered/missing attachments require investigation; they are never silently replaced and mailed. Business names are escaped in HTML, and plan-specific sections are not promised universally in email copy.

## Operator procedure

1. Open the customer's Reports screen and inspect PDF availability and email state separately.
2. For a generation error, fix the cause and request the same month again. For a running generation, allow 15 minutes before recovery; do not launch unrelated new periods to bypass it.
3. For email rejection, inspect sender configuration/permissions/recipient restrictions with the mail provider before retrying the original period.
4. For unresolved/uncertain email, use the stored provider receipt when available, recipient, time and report ID to investigate. Do not modify/delete the ledger to force a send. There is no one-click ambiguous delivery override or live delivery lookup in this release.
5. Preserve existing PDFs, email metadata and database backups on rollback. Reverting to the old sender would restore duplicate-send and false-success behavior.

Migration `20260910170000_report_delivery_state` retains columns on down. It does not resend or rewrite historical reports. Actual customer mail is not sent during validation. Provider mocks exercise receipts/rejections/timeouts; browser fixtures exercise labels and recovery guidance. Historical PDF calculations and rendering remain governed by [the accuracy verification](report-accuracy-verification.md).

## Provider pagination compatibility

The source reader also accepts EMR's observed Laravel simple paginator: current_page plus links.next, without last_page. The empty organization-26 campaign response was verified read-only in production. Both full and simple formats retain scoped reads, page limits and invalid-pagination rejection. Links are validated for origin and next page; remote link URLs are not followed as arbitrary requests.

Remaining report closeout: acquisition stuck-job recovery and the comprehensive paid-report/website claims audit. Actual monthly email inbox delivery remains a designated-recipient acceptance check. Stripe remains last.
