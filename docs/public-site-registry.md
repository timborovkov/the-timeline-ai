# Public document registry

The machine-facing public-site seam lives in
[`apps/web/src/lib/public-site`](../apps/web/src/lib/public-site). It is the
single source for canonical public paths, sitemap discovery, `llms.txt`,
`llms-full.txt`, capability disclosure, and reusable structured-data input.
Public route content and UI remain owned by their feature modules.

## Contribution interface

A feature contributes one `PublicDocumentSource`. Keep the source beside the
feature's public content, import only the public-site types and
`definePublicDocuments`, and never import an App Router page or the central
`PUBLIC_DOCUMENT_REGISTRY` from the source module.

```ts
import { definePublicDocuments } from '@/lib/public-site/registry';

import type { PublicDocument } from '@/lib/public-site/types';

export const CONNECTOR_PUBLIC_DOCUMENTS = definePublicDocuments('connectors', [
  {
    canonicalPath: '/integrations/github',
    kind: 'connector',
    title: 'GitHub project memory',
    description: 'Turn pull requests, reviews, and releases into cited project history.',
    indexability: 'index',
    dates: { modified: '2026-08-12', reviewed: '2026-08-12' },
    capability: { kind: 'native-ingestion', provider: 'github' },
    sitemap: { changeFrequency: 'monthly', priority: 0.7 },
    structuredData: [
      { type: 'web-page' },
      {
        type: 'breadcrumbs',
        items: [
          { name: 'Integrations', path: '/integrations' },
          { name: 'GitHub', path: '/integrations/github' },
        ],
      },
    ],
    llms: {
      section: 'integrations',
      order: 10,
      summary: 'Native GitHub ingestion for pull requests, reviews, commits, and releases.',
    },
  },
] satisfies readonly PublicDocument[]);
```

After the actual route exists, add the source to the arguments of
`createPublicDocumentRegistry` in
[`documents.ts`](../apps/web/src/lib/public-site/documents.ts). This one catalog
composition edit is the integration seam for sitemap and LLM discovery. Route
modules can resolve their document by canonical path and pass it to
`metadataForPublicDocument` and `buildPublicStructuredData`; serialize JSON-LD
with `stringifyJsonLdForHtml` before embedding it in a script element.
`use-cases`, `compare`, `solutions`, `integrations`, and `how-it-works` contributions receive
their own stable sections in both LLM files. Empty contribution sections are
omitted, so adding the first document is what makes its section appear.

Use-case documents live beside their shared page content under
[`components/marketing/use-cases`](../apps/web/src/components/marketing/use-cases)
and appear in the public Use cases menu. Compare documents live beside
their shared page content under
[`components/marketing/compare`](../apps/web/src/components/marketing/compare)
and appear in the footer Compare column as head-to-head pages. SEO titles and
descriptions on those vs URLs also name each as a competitor alternative so
people searching `[competitor] alternatives` can land on the cited comparison.
The Integrations
header dropdown and matching footer column list the hub plus live destinations:
Slack, Telegram, Google Drive, GitHub, Linear, Monday.com, Jira, and Notion,
labelled for native sync, capture, or MCP lookup. Works-with pages for Linear,
Jira, Notion, HubSpot, Attio, and Pipedrive still live under
[`/integrations`](../apps/web/src/app/integrations); coming-soon CRM pages stay
on the hub cards, not in that nav list. The agents hub and product-tour documents
are registered with the core public pages. Outcome-led solution documents remain under
[`components/marketing/solutions`](../apps/web/src/components/marketing/solutions)
for the remaining client-handoff page. Do not create title-swapped or orphaned
search variants.

Do not register speculative routes. A registry entry asserts that its canonical
route and curated content exist. Tests should fail if a feature removes a route
without removing its entry.

## Field contract

- `canonicalPath` is an origin-relative path with no query, fragment, dot
  segments, or trailing slash except `/`. The deployment origin is resolved by
  the route adapter, so content truth never depends on environment variables.
  Canonical URL generation percent-encodes raw XML and Markdown destination
  delimiters before a route enters sitemap or LLM output.
- `kind` identifies the editorial surface: landing, product, solution,
  connector, guide index, guide, trust, support, legal, or
  machine-readable document.
- `title` and `description` are the canonical discovery copy. Keep both
  single-line and human-authored.
- `indexability` controls discovery. A `noindex` document must set both
  `sitemap: false` and `llms: false`; the registry rejects accidental exposure.
- `dates.modified` is the date the route's public substance last changed.
  `dates.reviewed` is the date a person last checked it against product truth.
  Both are explicit `YYYY-MM-DD` source values. Never derive either from request
  time or build time.
- `capability` is product truth. Native ingestion is restricted to GitHub,
  Linear, Google Drive, Monday.com, Slack, and Sentry. `mcp-access` means live
  approved tool access from hosted Timeline, not passive ingestion. Local-only
  MCP catalog entries remain a separate directory tier and must not be described
  as hosted access. `planned` pages are forced to remain noindex and absent from
  sitemap and LLM discovery.
- `sitemap` supplies frequency and a finite priority from `0` through `1` for
  indexable HTML documents, or is `false` for machine documents and noindex
  pages.
- `structuredData` contains typed inputs for WebPage, CollectionPage,
  TechArticle, breadcrumbs, FAQ, and SoftwareApplication nodes. Set the
  SoftwareApplication `name` to the product entity (`The Timeline`) when a
  document's discovery title describes a page or solution. The registry does
  not accept arbitrary JSON-LD blobs.
- `llms` supplies a discovery section, stable order, short summary, optional
  full summary, and optional long-form sections with labeled links or fenced
  code blocks. Help resource links flow into those sections automatically;
  destinations must be absolute HTTPS URLs and are normalized before Markdown
  serialization. Set `llms` to `false` when a document should not appear in
  LLM-readable discovery.

## Verification

Add or update focused tests for the feature source, canonical metadata,
structured-data graph, sitemap presence or exclusion, and both LLM text files.
The registry validates duplicate paths, canonical path shape, real dates,
review chronology, discovery policy, sitemap priority, and native capability
names when its source module loads.

## Crawl and indexing policy

`/agents/setup.md` and `/agents/SKILL.md` are machine-readable Markdown routes.
They are registered as public machine documents with `llms: false` so the
hand-authored agent links in `llms.txt` / `llms-full.txt` provide discovery.
The compact index starts with product context and routes research, existing-account
setup, new-account setup, and already-connected agents separately. Installation
steps belong in `setup.md`; tool selection and operating rules belong in `SKILL.md`.
Product, guide, integration, pricing, trust, and support links come from the registry.
Use cases, solutions, comparisons, and companion references appear under `Optional`. `SKILL.md` is served from
`plugins/timeline/skills/timeline/SKILL.md` and must stay byte-identical.

`sitemap.xml` and `robots.txt` are generated at request time so their absolute
URLs use the runtime `AUTH_URL`. Prerendered public HTML (`metadataBase`, JSON-LD)
bakes the origin at `next build`. The web Docker image defaults `AUTH_URL` to
`https://thetimeline.cc` for that build so production pages do not ship
`http://localhost:3000`. Override the build arg for a non-canonical origin.

Request-time values that can differ from the Docker build (`SUPPORT_EMAIL`,
`TURNSTILE_SITE_KEY`, `TASK_CATEGORY_UI_ENABLED`, production Turnstile gating)
are not read during prerender. Public pages load them from
`GET /api/public/runtime`. A failed client fetch is not cached; the store
retries on window focus, pageshow, and client navigation. JSON-LD Organization
email stays the canonical
`contact@thetimeline.cc`. `/terms` is request-time so `LEGAL_PUBLICATION_READY`
cannot freeze the unpublished placeholder into static HTML.
`NEXT_PUBLIC_*` analytics and Sentry values are inlined into the client bundle
and must be passed as web image build args.

`robots.txt` blocks APIs, the authenticated app, and token-bearing invite and
verification routes. Publicly reachable HTML that declares `noindex` remains
crawlable so search engines can observe that directive and process redirects.
Use page metadata and the registry's `indexability` field to prevent indexing;
do not add ordinary noindex pages to the robots disallow list.

`/agents/provisioning.md` is a machine document linked from setup, excluded from the sitemap and automatic llms registry expansion, with a brief discovery link in llms.txt. The public skill and signed-in skill download read the canonical plugin SKILL.md. Discovery remains useful without an account or connection.
