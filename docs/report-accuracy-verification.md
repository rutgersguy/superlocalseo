# Measurement and review-request repairs — 2026-09-09

## Definitions

- Reporting periods use UTC [start, next-month-start). Rankings use the latest observation per keyword, location, engine and geographic area before period end. A later unranked observation supersedes an older rank.
- Average rank excludes unranked observations; coverage and gap categories include them. Deltas match the same observation identity, including engine and area.
- Citation presence is listed / verified checked observations, using latest location/directory observations. Unknown checks are not failures. NAP consistency has its own known-evidence denominator; no favorable location masks another location.
- Published review dates determine period inclusion. Missing ratings are not zero. Imported review subsets do not support whole-market competitor claims.
- Traffic estimates use stored search volume and stated CTR assumptions; unknown volume and unavailable historical inputs remain unavailable. Unversioned composite/ROI inputs are omitted from historical reports.
- AI metrics describe sampled scans and answers. NAP differences merit verification, but formatting differences alone do not establish a Google flag or ranking penalty.
- Legacy internal audit scores lacking the current methodology marker are withheld. Failed page fetches produce unavailable scores. Literal HTML in audit findings is escaped so findings cannot consume the document markup.

## Reviews

Ask every customer for an honest review. Internal feedback may be categorized by sentiment, but public-review access must be equally available regardless of sentiment. Repository copy does not change third-party EmbedMyReviews routing settings. Verify the active vendor flow independently before launching invitations; no invitations were sent during this work.

References: [Google review policy](https://support.google.com/contributionpolicy/answer/7400114?hl=en), [business information updates](https://support.google.com/business/answer/3480441?hl=en), [title links](https://developers.google.com/search/docs/appearance/title-link), [page experience](https://developers.google.com/search/docs/appearance/page-experience).

## Validation

- Backend build, frontend TypeScript and production build pass.
- 263 tests across 24 backend suites pass against disposable PostgreSQL and Redis. Jest requires forceExit due to existing open handles; this change does not claim to resolve that issue.
- Read-only production reconciliation covers all 5 clients and all 18 existing historical report datasets, including NerdBox's populated review account.
- Monthly populated/empty fixtures and audit PDFs were rendered with production Chromium and visually inspected. Audit rendering uses the actual audit PDF function. A real NerdBox August report was also rendered for inspection.
- No schema changes or customer messages are required.

## Deployment and existing PDF repair

Merge the tested branch to GitHub main and deploy that exact revision with scripts/deploy.sh. It backs up the database and recreates only api/web, leaving PostgreSQL and Redis running.

After deployment, run `docker exec superlocalseo-api node dist/scripts/rebuild-cached-reports.js --apply` to repair existing downloadable reports without sending email. Every existing PDF is backed up and every replacement is staged before replacement begins. The timestamped report-directory `.repairs` folder contains originals, repaired copies and a manifest. Preserve this backup. The original delivery status, recipient and sent_at remain unchanged; generated_at records the replacement generation time. Previously emailed attachments cannot be replaced by this operation.

If a replacement run stops midway, already replaced files remain valid and originals remain available in the manifest. Restore originals from that run's manifest and originalGeneratedAt if rolling back PDF content; use the predeployment database backup only when necessary. Do not use generateAndSendReport for historical repairs because it sends email.
