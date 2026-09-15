# Expanded on-page website checks

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
