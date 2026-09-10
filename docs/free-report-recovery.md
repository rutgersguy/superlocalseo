# Native free report recovery

Admin → Free report leads → **How report recovery works** explains eligibility. The per-request recovery action resumes the existing lead ID, consent, saved observations and final snapshot. It never creates a replacement lead or purchases an already attempted point again.

Workers persist a generation claim before scanning. Every progress save checks the claim and happens before the next paid provider call. A live claim blocks competing workers; claims without progress for 15 minutes can be replaced. A stale worker cannot save another progress update after replacement; any already reserved observation is skipped by the replacement, preventing duplicate purchase. The business profile now has a pre-call marker too: if its result is lost, recovery stops for operator/provider investigation rather than buying it twice. This conservative policy can leave a report incomplete and requires manual verification.

The admin endpoint is admin-only and locks the lead while checking BullMQ. Active, waiting and delayed jobs block recovery. Failed jobs are retried; completed jobs can be replaced only if recovery is eligible. A queue failure preserves the report and progress. Initial enqueue failures also preserve area selection and consent metadata.

Email uses durable `not_started`, `sending`, `accepted`, `rejected`, `uncertain`, and `legacy_unknown` states. The exact original payload is persisted before the external request. Only definitely rejected or never-attempted messages can be retried. Timeouts, missing receipts, crashes during sending, ambiguous HTTP responses and historical failures block retries indefinitely, including after Resend's 24-hour idempotency window. Accepted means provider acceptance, not delivery. The same saved report stays accessible independently of email.

Recovery can incur the remaining original scan calls or send the originally requested transactional email. It grants no marketing consent. Do not exercise production recovery as a smoke test. Verification should use mocked providers and isolated fixtures; real recipients require explicit approval.

Migration `20260910180000_prospect_recovery` classifies historical completed snapshots without accepted receipts as `legacy_unknown`. It preserves report data and does not attempt delivery. Rollback does not erase this safety classification.

Remaining manual cases: lost profile result, blocked/unknown provider acceptance, and stuck active queue jobs require investigation. There is deliberately no force-resend or fresh-scan button.
