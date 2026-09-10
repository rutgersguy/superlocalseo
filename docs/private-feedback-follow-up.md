# Private feedback follow-up

Reviews → Private Feedback is the local inbox for optional private responses at every rating. Public Google review access remains identical for all ratings. EMR delivers its own invitations; changing follow-up status or notes sends no message and publishes nothing.

Owners and accepted team admins can assign work to the account owner or another accepted admin, set New/In progress/Resolved, and save internal notes. Viewers can read feedback and status but cannot edit, export, or read internal notes. Removed teammates cannot receive new assignments; a saved assignment to a former teammate must be reassigned or cleared before saving. Notes and status use an optimistic version check: simultaneous edits return a conflict instead of silently losing another operator's work. Refresh and reconcile the saved content before retrying.

The expandable **How to manage private feedback** guide explains the workflow and consent/privacy rules to operators. Status, location and rating filters also apply to exports; pagination does not limit the export to the current page.

## Privacy and export

Pro owner/admin CSV exports have a 5,000-row ceiling and reject larger results instead of silently truncating. They contain only this account's matching rows and use the same contact masking as the inbox: vendor names/email/phone are masked; native email is readable only with explicit stored contact consent; phone remains masked. Native names remain visible as in the existing inbox. Notes and operator audit fields are omitted. Formula-like spreadsheet cells are neutralized and quotes/newlines escaped. Downloads use authenticated API requests and no-store response headers. Keep exported files secure and remove them when no longer needed.

This release adds no marketing consent, outreach automation, retention deletion, or data-subject verification workflow. Feedback remains stored under the existing account lifecycle. Authorized privacy requests still require support review; there is no configured automatic retention period. Do not use masked vendor contacts for outreach or interpret a rating as consent.

## Coverage

The inbox contains native submissions and EMR webhooks received by SuperLocalSEO. Historical EMR feedback and later edits are not backfilled or guaranteed complete; the existing first-seen vendor webhook semantics are retained. Empty filters mean no matching saved rows, not proof of no feedback at the source. Follow-up edits affect separate local columns and do not rewrite the original source message, rating or receipt timestamp.

Migration `20260910190000_private_feedback_follow_up` adds status, assignment, notes, editor/time and version fields. Its rollback preserves these records. Existing rows start with New; this is an untriaged local workflow state, not a claim of newly received source feedback.

Validation: pure privacy/CSV/schema unit tests; API integration coverage for tenant/role authorization, invalid assignment, optimistic conflicts, masking and export; disposable browser coverage for guide, assignment, persistence and mobile layout. Run integration and browser coverage on an isolated migrated test database before deployment. No production feedback edits or outbound requests are needed for acceptance.
