# Provider location mappings

Status, September 10, 2026: the registry now supports an explicit operator inspection paired with a live API membership check. This replaces PR #218's disabled placeholder. It does **not** provide automatic verification of the attached Google identity. Explicit mappings now route EMR imports, connection operations, reply guards and verified campaign delivery; the limited legacy path is described in [provider routing](provider-routing.md). No production customer mappings have been recorded by this rollout.

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

An admin opens the intended organization/location in EMR, inspects its attached Google source and records:

- EMR organization and location IDs, exact Google Place ID, and Google business name shown in EMR.
- The dashboard page URL, without query parameters/fragments or sign-in links.
- Inspection time within the last 30 minutes, with explicit confirmations of the selected location, exact Place ID and customer ownership.
- An internal note explaining the check.

On save, the backend independently checks `GET /locations/{id}`. An inaccessible location, organization mismatch, upstream error or missing credentials blocks the save. The Google identity remains **operator-attested**, labelled separately from API-verified membership in the stored evidence. The admin must actually inspect the source: workspace names, review counts, OAuth completion and source catalogs are insufficient.

For a location without a saved Place ID, a successful inspection atomically records its first ID alongside the mapping and audit event. An existing different ID cannot be overwritten through this form. The submitted previous ID and local identity snapshot prevent stale forms or concurrent edits from applying to changed records.

## Storage and protection

- Each local location can have one explicit EMR location, with globally unique EMR location ownership.
- An EMR organization belongs to one local customer; multiple branches of that customer can use distinct locations within it.
- Composite foreign keys enforce the local location/customer and provider organization/customer relationship.
- Existing provider IDs claimed by other customers block a mapping. Previous organization reservations remain after remapping and require deliberate reconciliation.
- A revision check and transaction lock prevent conflicting saves; a second identity check rejects changes made during external verification.
- Each successful save records the operator, time, note, revision and provider evidence. Historical events survive location/customer deletion; deleted operators become null.
- Saving an inspection changes local records only; it does not send a message or change provider configuration. Subsequent operations resolve that saved mapping. Changes to local name, address, city, state, ZIP, customer or Place ID invalidate the identity snapshot and require reverification. The record does not automatically detect later changes inside EMR.

## Provider capability findings

The [official API documentation](https://www.embedmyreviews.com/docs/api/) and live responses inspected September 10 confirm that `GET /locations/{id}` supplies `id`, `organization_id` and the workspace location name. The writable `/reviews/sources` endpoint does not establish attached Google identity. Live MCP discovery succeeded with the existing token; `list_organizations` and `list_locations` returned membership and aggregate review statistics, without a Google Place ID. These findings do not establish that no other vendor capability exists, but no supported automatic identity source was verified during this work.

The operator fallback is therefore an explicit design choice, not a claim that an entered Place ID has been validated by Google or EMR. Customer onboarding still requires a real owner-controlled rehearsal. Replacing manual inspection with automation requires a documented/live-verified attached-source identity response and new mismatch/error tests.

## Acceptance and rollout

Run backend tests, both builds and the isolated browser contract test before GitHub merge. Deploy through `scripts/deploy.sh` (no new migration). Verify the production admin page, capability flag and rejection of incomplete evidence; never invent an inspection for a production fixture to make the counter nonzero. GitHub release comments contain deployment evidence.

Owner clarification September 10: NerdBox is an intentional test account used to evaluate reviews, not a true signup. Leave its linked reviews intact for testing; do not rename it, bind it to a real business, or treat its name discrepancy as an onboarding defect. The earlier vendor UI inspection showed Light Hawk Studios, Place ID `ChIJnUBk_1kP9YgRfyGuF-BkCFk`. See [the earlier account investigation](review-account-verification-2026-09-09.md). This does not establish a verified production customer mapping. A live scoped review read on September 10 returned all 8 reviews (HTTP 200, one page), while the writable-source endpoint remained empty.

## Tests and next phase

Database tests cover authorization, strict inspection fields, missing/mismatched evidence, legacy conflicts, revision races, duplicate/cross-customer constraints, first-identity persistence, local identity changes and retained history. Provider adapter unit tests cover membership responses, missing/stale/future inspections, URL safety, upstream failures and missing credentials. Browser coverage exercises the complete inspection form, safe error display, submitted evidence, success message and mobile layout with simulated save responses; it does not prove actual external business ownership.

The routing implementation is covered in the [routing runbook](provider-routing.md). Real customer mapping population and owner-controlled acceptance remain outstanding. Then rehearse two distinct businesses and multiple branches before claiming multi-location readiness. Stripe remains last.

## VA guide

Click **How to map a location** at the top of **Admin → Provider mappings**. The modal explains the three IDs, source inspection, examples, notes, first-ID behavior and escalation conditions. Escape or either close button returns to the mapping form.
