# Expanded on-page website checks

DataForSEO OnPage crawling supplements the existing homepage checks. Website Performance remains powered by Lighthouse with its existing metrics and repair explanations; this feature does not replace or reweight those results.

New audits queue a crawl automatically. Existing historical audits are not purchased in bulk. A user can enroll the latest older audit with “Run expanded SEO checks” on Website Audit. The audit polling worker submits and retrieves results durably. A saved homepage is limited to 100 pages; a saved URL with a non-root path is limited to that one page to avoid crawling unrelated branches on a shared domain. The UI labels this scope. Each task loads resources and JavaScript, keeps subdomain expansion off, and leaves robots restrictions in force. A successful public-website preflight is required. Same-location, same-website tasks requested within 24 hours share an existing accepted result/task rather than buying another crawl.

The on-page panel presents crawl state, coverage, affected page URLs and original remediation guidance for errors, broken links/resources, duplicates, missing metadata/headings, image alt review, insecure links and canonical loops. Boolean observations alone determine pass/finding counts; absent fields are explicitly not checked. Empty pages, inaccessible sites and retrieval failures are not clean audits. The 100-page limit is not a promise of whole-site coverage. Provider thresholds identify review candidates, not guaranteed ranking penalties. The crawl does not establish causality or guarantee SEO results.

Paid task intent is persisted before dispatch. Ambiguous task creation is held for review without automatic repurchase. A submission interrupted for an hour, or retrieval unresolved after 24 hours, requires inspection of the existing provider task/tag. Never reset that identity blindly. Provider result GETs and page retrievals may be retried without posting a new crawl.

The existing homepage estimate and downloadable audit PDF retain their existing methodology; the expanded crawl findings are currently available in the Website Audit screen, not in that PDF. Results include their own retrieval timestamp and target URL, and do not overwrite Lighthouse evidence.

Sources:
- https://docs.dataforseo.com/v3/on_page/task_post/
- https://docs.dataforseo.com/v3/on_page/summary/
- https://docs.dataforseo.com/v3/on_page/pages/
