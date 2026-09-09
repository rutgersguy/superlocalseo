# Native free reports — #199

The homepage free-check CTA and `/audit` now use our native flow. `/dashboard/audit` remains the paid website-audit feature. Native report capability URLs are `/free-report/:uuid` and their API is `/api/free-reports`. They do not require an EMR login. Legacy vendor URLs are separate; do not claim they redirect until their supported vendor configuration is saved and verified.

## Sources and retained evidence

Google Places Text Search supplies transient business-selection choices, including service-area businesses. Those names, addresses, ratings and coordinates are not persisted; only the selected place ID is retained. The selection UI credits Google Maps and links to Google terms/privacy. DataForSEO Business Info independently resolves that exact ID for the stored business name, nullable address, rating/count and source time. Provider business coordinates are intentionally discarded.

The selected scan area comes from the pinned 2025 U.S. Census Places Gazetteer: 32,058 unique supported places across the 50 states/DC, with all IDs and coordinates validated. Puerto Rico is excluded from this initial scope. Coordinates are Census representative points, not storefront locations, city boundaries, or necessarily downtown centers. The UI says so and requires explicit city selection. `scripts/build-census-places.py` reproduces the JSON and verifies the source SHA-256. No vendor or Google business coordinate is silently substituted.

Each of nine points is approximately 2 km from its horizontal/vertical neighbor. Requests specify English, desktop, zoom 14z, requested depth 20 and search_this_area. Exact place-ID matches determine rank. Malformed, empty, duplicate-ID, duplicate-rank, gapped or count-mismatched result sets are unavailable, never proof of absence. Short but contiguous valid results retain their actual result count. Source collection time and retrieval time are distinct; unavailable source time is null.

Completed snapshots retain the normalized returned observations, keyword, coordinates, business identity, timestamps and formulas. They are not updated on view. These stored observations originate from DataForSEO, whose Live-results documentation instructs clients to store results they need; no indefinite Google Places cache is introduced. Census data are the independent source for geographic coordinates.

## Formula contract

- Checked = successful, usable point observations. Unavailable points are excluded.
- Found = checked points with an exact-ID rank. Missing rank remains null, never 21.
- Average rank = sum of found ranks / found points, rounded to one decimal; no found points => null.
- Bucket percentage = bucket point count / checked points, rounded to one decimal; no checked points => null. Independent rounding may sum to 99.9 or 100.1.
- A missing business is absent from the returned N results, not absent from Google. Percentages describe sampled points, not geographic area.
- Five-star advice cannot suggest a rating above five. Unsupported traffic/revenue/click forecasts and fabricated scores are omitted.

## Operations and retries

Public submission requires an explicit report-delivery-only consent version/time and an empty honeypot. Limits: three submissions/IP/day, two reports/email/rolling day, 50 reports globally/rolling day under a database advisory lock; business lookup ten/IP/hour and 300 globally/UTC day through Redis. These bound request counts, not a fixed currency amount. Provider prices can change.

BullMQ has one report worker per API process. Checkpoints preserve profile and completed points. An unavailable point is saved before its paid request, so recovery after an ambiguous crash does not blindly replay it. A completed snapshot is saved before email. Email acceptance records the provider message ID privately and is not represented as confirmed inbox delivery. Email retries reuse the snapshot and Resend idempotency key; normal retries occur within minutes. Do not manually replay delivery more than 24 hours later without first reconciling its provider status. No marketing subscription is created.

Queued reports remain queued; a processing report with no progress for 15 minutes gets a safe stalled message. Inspect the BullMQ job and `audit_leads.audit_data` to distinguish provider failure from scheduling failure. Raw provider errors, email and consent metadata are never returned from the public report endpoint. A capability URL exposes only business results; the page is noindex/nofollow and uses no-referrer. Report data remain in the existing audit-lead store; honor existing deletion requests/retention operations.

The source-column reconciliation migration is required on the drifted production database (see below). Workers must be enabled in production. Rollback should leave a clear unavailable native page rather than restore inaccurate vendor reports. Do not delete completed snapshots or provider connections.

## Verification

334 backend tests / 33 suites passed, including source identity, every Census row, null/zero arithmetic, partial/malformed maps, global/recipient spend caps, public privacy, scheduling failure and email retry without rescanning. Two browser scenarios passed on the isolated stack (desktop/mobile/print styles and failure recovery). The actual live-source Light Hawk snapshot was inserted into the isolated database, fetched through the public API, rendered in the browser and printed. API snapshot equality and every point were reconciled. The corrected A4 export is two readable pages.

Live pilot (2026-09-09): Light Hawk Studios, exact place ID `ChIJnUBk_1kP9YgRfyGuF-BkCFk`, rating 5.0, eight reviews, no address. DataForSEO business info reproduced the vendor's bad 46.423669/-129.9427086 coordinates; they are discarded. Selected Census area Atlanta city, GA (`1304000`) is 33.762909/-84.422675. For `video production company`, all nine searches returned 20 usable results with no exact-ID match: checked 9, found 0, average null, missing 100% of checked points. No email was sent by this pilot. Live owner inbox delivery and vendor legacy redirects remain separate release checks until recorded.

## Source references

- https://developers.google.com/maps/documentation/places/web-service/policies
- https://cloud.google.com/maps-platform/terms/maps-service-terms (section 14; coordinates are not blanket permission to retain all Places data)
- https://docs.dataforseo.com/v3/business_data-google-my_business_info-live/
- https://docs.dataforseo.com/v3/serp/google/maps/live/advanced/
- https://dataforseo.com/help-center/how-long-do-you-keep-results
- https://www.census.gov/geographies/reference-files/time-series/geo/gazetteer-files.2025.html

## Production schema reconciliation

The first production submission after #211 failed before insertion: `audit_leads.source` was absent, even though `20260508000000_audit_leads_source.js` was recorded as applied. The fresh test schema contained it. Migration `20260909010000_repair_audit_leads_source` conditionally restores the nullable column without changing historical leads or deleting source values on rollback. Deploy this repair with `scripts/deploy.sh --migrate`; verify the actual column and repeat the anonymous submission. The migration regression creates the missing-column shape in an isolated schema, observes the query failure, repairs it, and verifies both idempotency and data preservation.

The deployment script now checks the actual report source column after migrations and before recreating the app, so a misleading migration-history entry cannot silently pass this check again.
