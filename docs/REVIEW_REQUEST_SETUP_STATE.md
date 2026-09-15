# Review requests setup and errors

An account with no review provider organization, location, or explicit mapping receives `setupState: connection_required` and no campaigns. Review Requests shows a persistent **Connect Google reviews** button leading to Settings → Integrations, followed by assisted campaign setup. This state does not depend on a dismissible banner or credit availability.

Mapped accounts must pass provider route validation. Campaign reads filter both local customer ID and verified provider organization IDs. Partial IDs, stale mappings, routing conflicts, and database failures remain errors; they are never presented as an unconnected empty account.

The pilot's observed campaign error was HTTP 429 from the shared API limiter, not proof of a missing Google connection. The page now shows a rate-limit explanation and a retry action, preserves other server error messages, and does not automatically retry a failed campaign-list request. The API limiter itself is handled separately.

Validation: three unit tests cover an unprovisioned account, a routing conflict, and organization-scoped reads. Backend/frontend typechecks pass. Browser acceptance should check an unprovisioned fixture's connection button, connected/no-campaign setup, a mocked 429 with Retry, and a mapped campaign rendering without cross-tenant records. No invitation is sent for these checks.
