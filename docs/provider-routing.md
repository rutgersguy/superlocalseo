# Location-aware provider routing

This release connects the provider mapping registry to EMR operations and adds **Admin → Provider mappings → How to map a location**, a modal guide for onboarding VAs. It does not claim real customer onboarding acceptance or populate production mappings.

## Route resolution

A selected local location must belong to the authenticated customer. Once a customer has any explicit mappings, only a current inspection for the selected branch is accepted; stale or unmapped branches cannot fall back to client-wide IDs. Multiple local locations require selection for interactive connection operations. Organization ownership and conflicting historical assignments are rechecked.

Unmapped accounts with zero or one local location retain a checked legacy organization/location route. This supports existing onboarding and the deliberate NerdBox review fixture; it is not an automatically verified business identity. Multi-location accounts without mappings are blocked. Provisioning never silently replaces an explicit mapping or provisions one client's default location for several branches.

## Operations

- Connection GET/POST and sync accept `locationId` (query or body). The Google connection component adds a branch selector. Mapping mode is returned by the status API. Explicit branch status uses that branch's review count and sync timestamp; caches and import jobs are location-scoped.
- Review workers fetch each mapped provider location separately and store local location and provider-location provenance. Rechecks under a transaction lock reject route changes during the external fetch. Campaign metrics sync once per organization, retaining organization provenance.
- Reviews support an owned `locationId` filter and the inbox has a location selector. Earlier unassigned reviews stay in the all-locations view until reconciled by a scoped import. Trends and private-feedback totals remain customer-wide and are labelled separately. Private-feedback API filtering is available by owned location.
- Reply publishing requires current routing. After explicit mapping, unassigned or differently sourced historical rows must be refreshed before replying. Scope is held stable during the external publish call. No real replies are sent as part of acceptance testing.
- Campaign configuration verification binds the selected location, current mapping revision and campaign organization. Multi-location verification is supported with a current branch mapping; one campaign cannot be actively verified for two branches. Invitations require one current verified setup. A mapping or identity change invalidates old readiness. Campaign REST metrics remain organization-scoped; this implementation does not invent branch metrics from organization totals.
- Webhooks resolve explicit ownership and provider location. Ambiguous organization-only events for multiple branches are ignored rather than assigned arbitrarily. Mapped review events enqueue a location-scoped authoritative import. Private feedback is saved against the resolved local location. Provider authentication remains on the existing webhook routes.

## Operational limits

The Google identity inspection remains manual; later changes made inside EMR are not automatically detected by the local identity snapshot. The local name/address/Place-ID snapshot and mapping revision do detect local changes. A failed branch import retains existing reviews and records a branch error; scheduled retry can recover it. A failure may stop remaining branches for that customer in that run.

Accounts with both an active direct Google integration and explicit EMR mappings require source reconciliation before EMR import. Do not silently switch sources or claim a healthy zero-review result. No bulk deletion, provider relinking, historical branch guesswork, campaign delivery or real public reply is implicit in rollout.

The transition retains a legacy compatibility path. Removing it requires verified production mappings and a real owner-controlled rehearsal. Native review collection, delivery acceptance, recovery coverage and Stripe work remain separate open scope.

## Deployment and checks

Use the GitHub workflow and `scripts/deploy.sh --migrate`. Migration `20260910000000_provider_routing_provenance` adds review provider-location provenance, campaign organization provenance, feedback location and mapping-level sync status. It does not backfill or delete customer data; down preserves provenance.

Run the backend suite, both builds and browser tests for campaign setup, mapping inspection and guide open/close. Integration fixtures cover two branches and another customer, missing/foreign/stale mappings, scoped imports, reply blocking, branch campaign verification and invitation blocking, and ambiguous webhook routing. Provider sends/replies are mocked. Record actual test counts and post-deployment checks on the release PR.
