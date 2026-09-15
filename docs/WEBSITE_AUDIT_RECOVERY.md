# Website audit prerequisites and recovery

Website audits require a website saved on the selected location. Missing URLs return `WEBSITE_REQUIRED` before creating an audit or purchasing provider work. Saving a website enrolls the initial scan through the existing initial-scan workflow.

A completed listing-only audit with no page details, score, or Lighthouse task/result does not consume the 24-hour website audit cooldown. Pending/processing attempts still block duplicate manual runs. Null scores mean insufficient measured evidence, not zero; NAP and composite estimates cannot be computed without their required observations.

The website audit page shows page estimate, Lighthouse performance, and Lighthouse technical SEO. Review and Google Profile scores are not website measurements and are no longer displayed as empty cards implying that connecting Google will populate them. The page polls while open so customers can see asynchronous results without refreshing.

Recovery persists Lighthouse task IDs in processing fallback and historical on-page backfill. Recomputing listing scores reuses an existing task instead of purchasing a replacement. Historical on-page backfill skips already-submitted tasks and older rows superseded by a newer non-failed audit. The existing page/performance blend is unchanged.

Validation: targeted unit tests cover the missing-URL guard before provider work, reuse of an existing task, and preservation of a new task ID when page scoring is unavailable. Backend/frontend TypeScript checks pass. Integration and browser release checks are run by the release owner before deployment.
