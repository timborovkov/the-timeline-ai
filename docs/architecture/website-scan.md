# Website scan lifecycle

First-run scanning captures up to five public same-origin pages through Firecrawl. The user confirms permission to submit the site. Firecrawl is the only crawler; failures never fall back to an in-house fetcher.

- Reserve up to five accepted-source units before enqueue and recheck admission before calling Firecrawl. Settle returned pages once; downstream inference uses the AI meter.
- Persist immutable `website_sources` crawl results so retries reuse identical bytes. Each page has a cited `source: web` raw event and a versioned Markdown document.
- Scan IDs scope retries, source lists and atomic onboarding completion. Extraction and suggestion generation use existing pipelines; canonical objects require approval.

`onboarding/website-scan-job.ts` owns admission and handoffs; `website-source-scope.ts` owns team-scoped checkpoints and page snapshots. Client first-run screens import `@timeline/shared/onboarding/first-run`, not the Node onboarding barrel.

[Local setup](../setup/local.md) and [Railway](../railway.md#environment-variables) own credentials. [Application design](../design/app.md) owns the first-run interaction; [live evaluation](../testing/README.md#live-website-scan) owns verification. [Provider controls](../providers.md) and [support deletion](../setup/manual-support-deletion.md) cover retention and erasure; a crawl-result API expiry is not proof of deletion.
