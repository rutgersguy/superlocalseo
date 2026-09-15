# Expanded on-page website checks

**Deployed September 15, 2026:** [expanded audits #232](https://github.com/rutgersguy/superlocalseo/pull/232) and [crawl limits and explicit scope #233](https://github.com/rutgersguy/superlocalseo/pull/233).

## Customer and VA walkthrough

1. Open **Website Audit → On-Page SEO Checks → Crawl scope and limits**. Refresh the browser if the newly deployed control is missing; a new audit is not needed just to see it.
2. Review the saved website and choose the scope below. A URL path alone does not prove that it represents a separate business location.
3. Click **Save crawl scope**. This saves the preference for future crawl dispatches; it does not purchase a crawl, restart an accepted task, or change existing findings.
4. Expand an issue to see why it matters, **How to fix it**, and affected page URLs. Review **All checks and coverage** for missing observations.

| Scope choice | Pages eligible for a future crawl | Cap |
|---|---|---|
| Automatic | Homepage URL: website; non-root URL: saved page only | 25 or 1 |
| Website | Broader website, potentially covering several locations | 25 |
| Saved URL section and subpages | Exact saved path and its descendants; not necessarily location-specific | 25 |
| Saved page only | Saved page, without expanding to other pages | 1 |

Every new scope uses a maximum linking depth of three. A shared franchise site without distinct location paths can use Website for broader findings or Saved page only for narrower coverage. Do not describe broader website findings as specific to one location.

## Implemented behavior

DataForSEO OnPage crawling supplements the existing homepage checks. Website Performance remains powered by Lighthouse with its existing metrics and repair explanations; this feature does not replace or reweight those results.

New eligible audits queue a crawl automatically at onboarding, monthly (first day at 09:00 UTC), and on manual audit requests subject to the existing cooldown. Historical audits are not purchased in bulk; the latest older audit can be enrolled from Website Audit. The maximum is now **25 pages and three links deep** (starting page depth zero). Sitemap ordering is disabled because the provider ignores depth limits when it is enabled. Service, location, contact and about URLs discovered directly on the starting page are prioritized (maximum 20); no guessed URLs are purchased.

**Scope is explicit, not inferred from a business name or URL path.** Under “Crawl scope and limits” customers can choose Website, Saved URL section and subpages, Saved page only, or Automatic. Automatic uses a full website scope for a homepage and one page for a non-root URL. Website findings can cover multiple businesses/locations; selecting a URL section does not establish that it is location-specific. Shared websites without a distinct location section can use a limited broader website audit or a single-page audit. Scope preferences are stored on the location and affect future dispatches, not existing accepted tasks. Subdomains remain excluded. A redirect out of the selected scope is rejected; canonical www/HTTPS redirects are allowed.

Query-string URLs are excluded, including search/filter and tracking variants. Starting URLs have query strings and fragments removed. Search, filter, account, sign-in, registration, cart and checkout paths are excluded. Custom robots restrictions merge with site restrictions; no override is used. Explicit section rules allow only the exact saved path and descendants, with matching exclusions within that section. Returned page findings are also scope-filtered. These limits concern crawled pages; page resources and JavaScript still load for diagnostics.

Same-location, same-website requests within 24 hours reuse accepted tasks/results without a new crawl purchase, including after changing preferences. Each new task snapshots its policy so later policy changes cannot relabel historical coverage. Older 100-page/single-page results remain labeled with their actual limits. Performance and remediation instructions remain intact.

The on-page panel presents crawl state, coverage, affected page URLs and original remediation guidance for errors, broken links/resources, duplicates, missing metadata/headings, image alt review, insecure links and canonical loops. Boolean observations alone determine pass/finding counts; absent fields are explicitly not checked. Empty pages, inaccessible sites and retrieval failures are not clean audits. The 25-page limit is not a promise of whole-site coverage. Provider thresholds identify review candidates, not guaranteed ranking penalties. The crawl does not establish causality or guarantee SEO results.

Paid task intent is persisted before dispatch. Ambiguous task creation is held for review without automatic repurchase. A submission interrupted for an hour, or retrieval unresolved after 24 hours, requires inspection of the existing provider task/tag. Never reset that identity blindly. Provider result GETs and page retrievals may be retried without posting a new crawl.

The existing homepage estimate and downloadable audit PDF retain their existing methodology; the expanded crawl findings are currently available in the Website Audit screen, not in that PDF. Results include their own retrieval timestamp and target URL, and do not overwrite Lighthouse evidence.

Sources:
- https://docs.dataforseo.com/v3/on_page/task_post/
- https://docs.dataforseo.com/v3/on_page/summary/
- https://docs.dataforseo.com/v3/on_page/pages/

## Release verification and limits

- The implementation passed 612 backend tests, targeted crawl policy/lifecycle tests, browser scope-save and repair-guidance tests, and all five GitHub release checks.
- Production was rebuilt and migrated from GitHub main. The live AirServe scope control saved successfully while its existing one-page audit and Lighthouse metrics were preserved.
- Before the limit change, live crawls completed for AirServe (one page) and Legacy Fitness (seven pages). Those results are historical evidence, not new crawls under the revised policy. The new provider request limits and exclusions were checked in automated tests and in the rebuilt runtime; saving scope did not trigger another paid crawl.
- Expanded findings remain in the app only; adding them to the downloadable audit PDF is not implemented.

## API and storage reference

All routes below require the signed-in client and the existing Pro feature gate. Audit IDs and locations are checked against the current client.

| Route | Behavior |
|---|---|
| `GET /api/audits/bl` | Client audit history, including crawl state and findings |
| `POST /api/audits/bl/generate` | Request a new location audit; existing 24-hour website cooldown applies |
| `POST /api/audits/bl/:id/crawl` | Enroll the latest older audit if it has no crawl; does not reset an accepted task |
| `GET /api/audits/bl/:id/crawl-scope` | Read the location's saved scope and website |
| `PUT /api/audits/bl/:id/crawl-scope` | Save `scope`: `auto`, `website`, `section`, or `page`; no paid dispatch |
| `GET /api/audits/bl/location/:locationId/history` | Completed location audit history |

`locations.website_crawl_scope` stores the future preference. New accepted tasks preserve their policy in `location_audits.crawl_data.policy`, alongside durable task identity and status. Do not rewrite historical policies to match current limits.
