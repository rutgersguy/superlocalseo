# Interior redesign — September 9, 2026

The authenticated workspace now shares the public homepage system: forest navigation, warm cream canvas, white working surfaces, editorial serif page headings, restrained orange actions, sage table headers, and clear semantic status treatments.

The shipped work covers the shared shell, responsive navigation drawer, focus handling, dashboard overview, AI visibility lead, Google rankings filters and observation labels, review empty states, competitor Lite messaging, report archive/latest brief, authentication styling through the theme tokens, generated report default branding, and the shared red-pin wordmark. Existing API calls, plan gates, prices, white-label overrides, and URLs remain unchanged.

Dashboard estimates remain explicitly modeled, and repeated per-keyword estimates are labeled instead of being presented as a total. Rankings use the same engine and service-area filters for the summary and table. Empty reviews distinguish missing synchronized data from a filter mismatch. The competitor Lite state uses a truthful upgrade explanation and no fabricated preview rows.

Generated PDFs now use the same visibility-brief language: a forest masthead, editorial headings, sage summary/table panels, warm recommendation panel, and a transparent page wrapper so a cream rectangle is not repeated across printed page breaks. The report download controls use `apiFetch(..., rawResponse: true)` so the bearer token is attached; plain links to protected PDF endpoints are not supported.

Branding is shared through `frontend/src/components/BrandWordmark.tsx`: the login screen uses the red pin with dark wordmark, while the forest app sidebar uses the same mark with a light wordmark for contrast. `frontend/public/sls-favicon.svg` is declared in `frontend/index.html` as the site favicon.

Validation includes TypeScript, Vite production build, targeted report unit tests (25 passing), responsive browser checks for the public page, and the isolated test stack for authenticated Lite/Pro/new-user flows before production deployment. The latest production deployments completed with site HTTP 200, API HTTP 422 validation response, and zero API errors since restart.
