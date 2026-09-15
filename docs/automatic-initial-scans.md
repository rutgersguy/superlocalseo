# Automatic first scans

Saving a location (during onboarding or in Settings) enrolls that location in six durable first-scan steps. Saving business/industry details and completing onboarding use the same enrollment; revisiting those screens does not purchase another first scan.

| Step | Prerequisites | Result |
| --- | --- | --- |
| Rankings and competitors | Business name, city/state, keyword | Ranking snapshots, keyword volumes, and competitors observed in the same search results |
| Citations | Pro, business name and city/state | Verified/unverified directory observations |
| AI visibility | Business name and city/state | Sampled assistant answers, including honest unavailable outcomes |
| Reviews | Connected EMR integration, valid location mapping and confirmed Google profile selection | Scoped review import; no invitation or public reply |
| Map | Pro, keyword, address and geocoded coordinates | One nine-point sample for the oldest keyword, at roughly one-mile spacing |
| Website audit | Pro and website | Existing verified-observation score calculation, website checks, and a Lighthouse task whose result is polled normally |

Active subscriptions and unexpired trials are eligible. A missing prerequisite leaves the step waiting. One-minute reconciliation checks only enrolled locations, so completing a connection or geocoding later can start the waiting step without a Refresh click. Queue outages preserve enrollment in Postgres.

The dashboard shows first-scan progress and prerequisite guidance. While first scans finish, the UI revalidates the associated data; the map defaults to a location and keyword. The first dataset takes processing time and is not promised to be synchronous with registration. Monthly reports/emails are not sent by this runner: they require a completed reporting month. Citation submission, invitations and public replies are actions, not scans, and are not performed.

## Recovery and limits

`initial_scans` has one row per location and step. Before external work, a conditional update claims `waiting` → `running`. Duplicate deliveries cannot reclaim an attempted step. Existing snapshots are reused. Pre-ledger pilot jobs named `initial-{rankings|citations|ai}-{locationId}` are adopted: active jobs are awaited and finished jobs without observations require review instead of another purchase. Each step finishes as `complete`, `existing`, or `needs_attention`; missing inputs remain `waiting`. Running longer than twenty minutes is displayed as needing attention; reconciliation can proceed with unrelated unattempted checks without reclaiming the interrupted step.

A crash after a paid call but before saving the result is ambiguous. The system deliberately does not automatically repurchase that step. Support must inspect saved observations, provider evidence and queue state before authorizing a fresh attempt. Failed steps retain partial snapshots. The regular refresh schedules remain separate; this ledger deduplicates first-scan enrollment, not all scheduled/manual scans.

No migration backfills all historical customers. To enroll a specific existing customer's saved locations, call `ensureInitialScans(clientId)` from the compiled service, or save their location details. This can make paid provider requests and must only be done for an intended customer. Existing observations are retained, including test fixtures. A completed initial scan is not rerun merely because the business edits its details; normal refresh/recovery handles subsequent changes.

The map uses geocoded address coordinates, which remain an estimate rather than a verified rooftop location. Service-area businesses without a saved address wait for a usable center. A missing/malformed Maps provider result fails instead of recording an invented unranked observation.
