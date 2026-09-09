# Google connection recovery — issue #196

Settings and onboarding share the same connection UI. Status reads never provision a business. OAuth completion means authorization returned; only a used connect link with used_at establishes that a profile was selected. This historical event does not prove that Google credentials remain valid. Imported Google review count and last successful import are separate evidence; zero reviews is valid and an unperformed import is unknown.

A customer can reconnect, resume an active link, recover from a blocked popup with an ordinary link, check status, and request a scoped review import. Polling runs every 30 seconds for at most ten minutes. Provider link history is cached for 30 seconds. Initial selection requests an import automatically; refresh is rate limited to once per minute. Neither action publishes replies nor sends review invitations.

Provisioning serializes requests per client. External IDs are committed before cosmetic naming. Ambiguous external creation failures retain the creating marker so retries cannot silently create duplicate organizations. Definite provider 4xx rejections except request timeout permit retry. Provider writes are never automatically replayed after rate limiting. Reads have bounded rate-limit retries and request timeouts.

## Operator recovery

For needs_attention or CONNECTION_MAPPING_REQUIRED, inspect the stored organization and location and compare them with the provider before changing anything. A partial mapping or creating marker may represent a successful external creation whose response was lost. Find and reconcile that existing resource; do not blindly force creation. Confirm neither organization nor location belongs to another client. Existing shared mappings are refused rather than automatically moved.

## Validation and remaining work

309 backend tests passed across 30 suites including the final import-readiness guard. Two browser scenarios passed against the isolated stack with provider API responses simulated: Settings recovery/blocked popup/business selection/zero reviews and onboarding recovery. Builds passed. The AI visibility test fixture now gives engines from the same scan one timestamp.

Live Google consent and revocation still require a business owner to exercise them. Full multi-location provider mapping is not delivered by this change; the existing client-level provider location remains. EMR connect-link history is not a live credential-health API. Stripe activation remains deferred.

Provider semantics: https://www.embedmyreviews.com/docs/api/ (connect-links used_at, completed_oauth_at and newest-first listing).
