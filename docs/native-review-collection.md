# Native review collection and QR links

Implementation for #205, with private-feedback filtering/pagination supporting #206. These pages are for direct sharing and printed QR codes. Campaign destination migration is not verified; existing EMR email/SMS destinations remain unchanged.

## Customer workflow

Open Dashboard → Campaigns → Review links and QR codes. Each owned location shows its readiness and a destination preview. An owner or team admin can create a link after the location has a current explicit Provider mapping. The support operator must inspect the actual Google listing as described in the provider mapping guide. A legacy provider ID or an unverified saved Google Place ID alone does not enable issuance.

The customer can preview `/review/{opaque-token}`, download an 800 px PNG QR, disable a link or create a replacement. Ordinary creation is idempotent. Replacement creates a new 256-bit token and permanently invalidates the old URL; disabling keeps it unavailable. The confirmation explains that printed codes must be replaced. Template changes do not change the URL. A changed mapping revision or local business identity makes the old URL unavailable until a replacement is issued after verification. No legacy QR or vendor form is changed or redirected in this release.

The public page renders only the business name and a server-constructed Google review destination. It never accepts a user-provided redirect, branding URL or tenant ID. The same prominent Google link remains available before selecting a rating, at ratings 1–5, after a feedback error, and after submission. Private feedback is optional and never publishes a Google review.

## Private feedback

Feedback accepts a 1–2000 character message, optional 1–5 rating, optional name (100 characters), and optional email (254 characters) with explicit follow-up consent. No phone or marketing consent is collected. The page states that the business receives the submission through SuperLocalSEO. HTML is displayed as text by React.

Records use the existing tenant-scoped `private_feedback` table with location, native source, consent and submission provenance. The owning account can read supplied follow-up details; existing vendor contact masking remains unchanged. Reviews → Private feedback supports location/rating filters and pagination. No email notification or outbound response is sent automatically.

A client-generated UUID and payload hash make exact retries idempotent under concurrent requests, including a response lost after commit. Conflicting reuse returns 409. The browser freezes an uncertain submission and retries the exact request. Validation failures permit correction. Invalid/revoked/stale links cannot write or retrieve private records.

Spam controls: strict schema, bounded message/contact fields, honeypot and ten POST attempts per IP per 15 minutes, plus the existing global limiter. The dedicated limiter is active in tests. Its memory store resets on process restart and is per API process; move to a shared store before horizontal scaling. This is initial abuse protection, not a guarantee against distributed spam. Public reads are not subject to the feedback-specific limit. No IP is stored in feedback records.

## Channel boundary

The [EMR API reference](https://www.embedmyreviews.com/docs/api/) checked September 10, 2026 documents campaign listing and invitation submission, but does not document a REST campaign destination-edit endpoint. This does not prove whether an operator can configure an external collection URL in the vendor UI. Until inspected and tested per channel, email and SMS retain their existing verified vendor-hosted flow. No campaign template, recipient list, widget or issued QR is silently migrated. #205 stays open for channel acceptance.

## Deployment and rollback

Migration `20260910010000_native_collection` adds the link table and additive feedback provenance columns. It does not create live links, backfill customer feedback or change existing provider mappings. Deploy with `scripts/deploy.sh --migrate`. Its down migration intentionally preserves issued links and feedback; application rollback must retain this route or explicitly communicate temporary unavailability of newly printed QR codes. Disable issuance in the UI if needed while keeping the public route and data available.

## Verification

Backend integration tests exercise two-account isolation, mapping preconditions, deterministic destination, all ratings, exact/concurrent retries, contact consent, malicious fields, spam limits, authenticated QR generation, invalid/retired links, revision/identity changes, rating filters and pagination. Browser acceptance uses an isolated mapping fixture and normal customer login, downloads a PNG, exercises mobile/keyboard controls, simulates a lost response after DB commit, observes one feedback record in the inbox and revokes the link. No public Google review or real invitation is submitted.

Production acceptance and final test counts are recorded on the pull request. Owner-controlled real-business acceptance remains #208.
