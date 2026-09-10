# Provider location mappings

Status, September 10, 2026: mapping storage and inventory implemented in [PR #218](https://github.com/rutgersguy/superlocalseo/pull/218); binding remains disabled. Live inventory is complete. All 350 backend tests (37 suites), both builds and the isolated browser check passed. GitHub CI and post-deployment results are recorded on that PR. This work covers explicit mapping storage and the identity audit; downstream reviews/campaign routing is a separate change.

## Live inventory — September 10, 2026

All three local locations were queried directly. EMR returned five organizations on one complete page (`total=5`, `last_page=1`, `next=null`). Individual location GETs confirmed all three legacy memberships:

| Local business/location | EMR organization | EMR location | Saved Google Place ID | Result |
|---|---|---|---|---|
| AirServe of Tulsa / Aire Serv of South Tulsa | 23 | 30 | Missing | Membership confirmed; business identity unresolved |
| Latino Tire / Main office | 25 | 32 | Missing | Membership confirmed; business identity unresolved |
| NerdBox / NerdBox | 26 | 33 | Missing | Membership confirmed; Intentional review-testing fixture; not a real-customer onboarding failure |

Five local customer records were also checked: one additional Brent Broadnax customer has legacy organization/location 24/31 but no local location; another has no provider IDs and no location. EMR organization 1 is the agency workspace. No duplicate provider IDs occur among the four provisioned customer records. Zero explicit mappings were saved. EMR location 33's writable-source endpoint returned HTTP 200 with `data=[]` and `total=0`; it cannot establish the attached Google identity. This result must not be interpreted as proof that this workspace has no Google reviews.

## Operator screen

**Admin → Provider mappings** (`/admin?tab=provider-mappings`) lists local business locations, saved Google Place IDs, historical client-level provider IDs and explicit mappings with revision history. Historical IDs are references only. No automatic backfill or name-based matching is performed.

Saving is currently disabled. The server also rejects writes with HTTP 409 until the provider evidence adapter is implemented and verified. The presence of a form or passing mocked storage tests does not mean live identity verification works.

## Storage and protection

- Each local location can have one explicit EMR location, with globally unique EMR location ownership.
- An EMR organization belongs to one local customer; multiple branches of that customer can use distinct locations within it.
- Composite foreign keys enforce the local location/customer and provider organization/customer relationship.
- Existing provider IDs claimed by other customers block a mapping. Previous organization reservations remain after remapping and require deliberate reconciliation.
- A revision check and transaction lock prevent conflicting saves; a second identity check rejects changes made during external verification.
- Each successful save records the operator, time, note, revision and provider evidence. Historical events survive location/customer deletion; deleted operators become null.
- The new registry does not change provider data, send messages, or change existing review/campaign routing. A saved Place ID change marks an existing mapping as needing reverification in the admin list.

## Identity evidence still required

The [official EMR API documentation](https://www.embedmyreviews.com/docs/api/) inspected September 10 documents `GET /locations/{id}` with `id` and `organization_id`, which can establish membership. Its `/reviews/sources` endpoint is documented as writable testimonial/custom sources; `/sources` is the global source catalog. Neither documented response establishes the attached Google business's Place ID. The repository's older `listReviewSources` comment describes broader historical behavior; that discrepancy needs a live probe before relying on it.

`readProviderMappingEvidence` therefore fails closed. Do not replace it with a comparison of operator-supplied IDs, workspace names, global source names, arbitrary scans, or a completed-OAuth flag. None establishes which Google listing is attached to the requested provider location.

To activate:

1. Reconnect SSH and read the canonical server instructions; synchronize with current GitHub main.
2. Inventory every local location and provider organization/location with complete bounded pagination. Record unresolved, duplicate and conflicting legacy assignments.
3. Inspect supported authenticated provider responses without logging keys or review/customer content. Establish the exact attached Google Place ID and organization membership. If REST cannot provide that evidence, investigate supported MCP tools or document the remaining vendor-side verification requirement before changing the design.
4. Implement the evidence adapter with bounded timeouts, response/schema validation, exact identity checks and safe errors; add realistic response tests for mismatches, missing identity, upstream errors and pagination.
5. Enable the server capability and UI only after those checks pass. Save only confirmed matches through the normal admin API so the audit trail is preserved.
6. Run database integration tests, browser checks and CI; merge through GitHub, deploy with `scripts/deploy.sh --migrate`, and verify production.

Owner clarification September 10: NerdBox is an intentional test account used to evaluate reviews, not a true signup. Leave its linked reviews intact for testing; do not rename it, bind it to a real business, or treat its name discrepancy as an onboarding defect. The earlier vendor UI inspection showed Light Hawk Studios, Place ID `ChIJnUBk_1kP9YgRfyGuF-BkCFk`. See [the earlier account investigation](review-account-verification-2026-09-09.md). This does not establish a verified production customer mapping. A live scoped review read on September 10 returned all 8 reviews (HTTP 200, one page), while the writable-source endpoint remained empty.

## Tests and next phase

Added database tests cover authorization, invalid requests, missing/mismatched evidence, legacy conflicts, revision races, duplicate/cross-customer constraints, same-customer branches, identity changes during verification and retained history. These tests mock the provider evidence adapter; the real-adapter unit test separately proves writes remain blocked without evidence. Local type checks, server builds and all 350 backend tests (37 suites) passed. The isolated Playwright check passed for the admin listing, disabled form and mobile overflow. No production customer data was changed by those tests.

After the registry is verified and populated, migrate connection, review import, reply and campaign/setup consumers to resolve explicit per-location mappings. Reconcile provisioning and webhook behavior as part of that migration; existing legacy writers do not consult this registry. Then rehearse two distinct businesses and multiple branches before claiming multi-location readiness. Stripe remains last.
