# Sentry setup

> Optional locally. Strongly recommended before production.

Hook the web and worker services into Sentry for error tracking. Timeline can also connect Sentry as a native source so selected Sentry projects sync issue and release activity into the timeline.

<span id="project"></span>

## 1. Project

1.  Sign up at <https://sentry.io>.
2.  Create a project — platform `next-js` for web, `node-express` for worker.
3.  Copy the DSN.

Set in `.env`:

    SENTRY_DSN=https://...@o0.ingest.sentry.io/0
    NEXT_PUBLIC_SENTRY_DSN=https://...@o0.ingest.sentry.io/0
    NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE=0
    NEXT_PUBLIC_SENTRY_PROFILES_SAMPLE_RATE=0
    SENTRY_ENVIRONMENT=development
    SENTRY_TRACES_SAMPLE_RATE=0
    SENTRY_PROFILES_SAMPLE_RATE=0

<span id="privacy-account"></span>

## Privacy and account checklist

Sentry can receive exception messages, stack traces, breadcrumbs, runtime metadata, and source maps. Before setting a production DSN, verify and preserve evidence for the account controls that the repository cannot enforce:

- **Region:** choose the intended [US or Germany data location](https://sentry.io/changelog/data-storage-location-in-germany-is-generally-available/), confirm that the production DSN belongs to that organization/region, and record the choice. A hostname or an old vendor overview is not sufficient residency evidence.
- **Retention:** set the shortest operationally useful event retention allowed by the plan and record the exact period. Do not rely on Sentry's older 90-day security overview as proof of the current account setting.
- **Seer and other AI features:** keep them disabled unless their data flow, model providers, retention, training terms, product purpose, and public disclosures have been reviewed and approved. A provider statement about Seer does not establish Timeline's configuration.
- **Contracts and subprocessors:** execute the current [Sentry DPA](https://sentry.io/legal/dpa/), review the applicable subprocessor and transfer terms, and retain their dates with the account evidence.
- **Access:** limit organization/project roles and API tokens to named operators and CI jobs, use the strongest available authentication, review membership and support access after role changes, and keep source-map upload credentials out of runtime services.
- **Sampling:** keep trace and profile sampling at zero until a separately approved observability need defines the fields, rate, retention, and disclosure.

<span id="wiring"></span>

## 2. Wiring

The web service initializes Sentry from the Next.js instrumentation files and routes browser events through the App Router handler at `/sentry-tunnel`, which forwards envelopes only to the configured DSN ingest host. That handler is not a Next.js `tunnelRoute` rewrite: on Next 16.3+ the rewrite proxies through `proxyRequest` and stacks enough `ServerResponse` `close` listeners to emit `MaxListenersExceededWarning`. The worker initializes `@sentry/node` on startup, captures fatal startup/shutdown errors, and captures BullMQ job failures with a `terminal` tag for exhausted or unrecoverable failures. Embedding provider timeouts with queue retries remaining produce warning breadcrumbs instead of error events; exhausted, unrecoverable, and other failures remain error events. The worker flushes before exit.

App Router render boundaries, API route handlers, server actions, webhook background handlers, queue handoffs, and other caught-but-unexpected operational failures report to Sentry explicitly before returning graceful responses. Machine-to-machine authentication, configuration, and malformed-payload failures are reported even when the endpoint returns a provider-friendly `200` to avoid retry storms. Deliberate no-op outcomes such as idempotent duplicates, unknown tenants, missing optional matches, and rate-limit skips stay out of Sentry unless they throw. Handled warning events use a small in-process throttle per message, operation, and reason so public bad-signature traffic cannot create one Sentry event per request.

Server action catch blocks that convert exceptions into returned action errors call Sentry before returning unless the failure is expected product control flow, such as a malformed approval payload or duplicate object proposal that is already persisted as failed approval state. Expected Auth.js credentials failures for invalid email/password sign-in attempts are rate-limited per source IP and submitted email, then emit throttled handled warning events instead of exception alerts. Plain validation, signed-out, not-found, and permission-denied branches that do not throw remain product control flow.

Server actions run through `runSentryServerAction`, which delegates to Sentry's `withServerActionInstrumentation` helper with only a validated `sentry-trace` value when present. This gives actions named `serverAction/<operation>` spans and preserves trace continuity without passing the complete request-header map or recording form data.

Agent model runs, native tools, and custom MCP tool calls also report caught internal failures. Tool events include only the safe tool-name tag before returning `tool_failed` or a graceful reconnect shape to the model. Shared LLM wrapper failures are tagged with `aiOperation`, `aiModel`, and the safe cause type so worker and web captures can be filtered without attaching prompt, transcript, file, document content, or provider error bodies. The wrapper records sanitized bounded cause messages and sanitized retry metadata, not the provider's original exception chain.

Keep Sentry `dataCollection` restricted (no user info, cookies, HTTP bodies, database query data, GraphQL documents, queue payloads, stack-frame locals, or genAI payloads). Sentry JS 11 dropped `sendDefaultPii` and transaction `profilesSampleRate`; `SENTRY_PROFILES_SAMPLE_RATE` and `NEXT_PUBLIC_SENTRY_PROFILES_SAMPLE_RATE` stay in env for deploy compatibility but are unused until a profiling integration is added. The Next.js wrapper imports `withSentryConfig` from `@sentry/nextjs/config`. Do not attach cookies, auth headers, prompts, transcripts, filenames, uploaded content, or raw document text to Sentry events. The scrubber removes request cookies and the entire request-header map before send. It strips query strings and fragments from request and breadcrumb URLs, redacts invite and verification path tokens, and redacts Telegram Bot API tokens (`api.telegram.org/bot<token>/…` and `api.telegram.org/file/bot<token>/…`). Browser-side filtering also drops known injected extension noise such as MetaMask in-page script connection errors, so third-party extension failures do not page as Timeline app failures. The web proxy rejects malformed `multipart/form-data` requests (missing/empty/unusable `boundary`, or explicit zero `Content-Length`) with `400` before Next.js App Router Server Action parsing, without requiring `Content-Length` so legitimate Server Action form posts still work over HTTP/2. Sentry drops the residual `Failed to parse body as FormData` noise that still lands on `/_not-found` from scanner traffic while keeping FormData failures on real routes.

These are targeted filters, not a general content-removal guarantee. The implemented scope disables Sentry's default PII collection, removes request cookies and all request headers, avoids attaching prompts/transcripts/files in Timeline's explicit captures, sanitizes request and URL-bearing breadcrumb fields, bounds LLM failure metadata, and redacts known credential-bearing URL patterns. Unexpected exception strings, stack locals, arbitrary breadcrumb text, request-derived values, and errors thrown by third-party code can still contain customer content. Inspect representative test events before production enablement and after adding new integrations; do not claim that Sentry can never receive customer data.

<span id="source-maps"></span>

## 3. Source maps

The web build uploads Next.js source maps through `withSentryConfig`. The worker build runs `sentry-cli sourcemaps inject` and `sentry-cli sourcemaps upload` for `apps/worker/dist`, `packages/shared/dist`, and `packages/db/dist`. Set these only in CI/deploy environments that should upload source maps, and make sure they are available at build time, not only runtime:

    SENTRY_AUTH_TOKEN=
    SENTRY_ORG=
    SENTRY_PROJECT=
    SENTRY_RELEASE=

`SENTRY_RELEASE` is optional because injected debug IDs are enough for source-map matching, but setting it to the deployed git SHA makes Sentry releases easier to audit. Without the first three values, the worker upload script logs a skip and local builds still succeed. The live integration canary also uses these values for a read-only project lookup; if it reports `403`, grant the token project read access to the configured org/project or update `SENTRY_ORG` and `SENTRY_PROJECT`.

Docker app-profile builds pass the same four source-map variables as build args. The web image also receives `NEXT_PUBLIC_SENTRY_DSN` and browser sample rates at build time because Next.js inlines public browser variables into the client bundle. Runtime Docker containers receive `SENTRY_DSN`, public Sentry variables, server sample rates, `SENTRY_ENVIRONMENT`, and `SENTRY_RELEASE` from the host environment so local production-parity containers exercise the same Sentry paths as Railway.

<span id="alerts"></span>

## 4. Production alerting checklist

Production configuration verified on 2026-10-24: web, main worker, and the dedicated document-extract orchestrator report to `irmin-dw / the-timeline-ai` with `SENTRY_ENVIRONMENT=production` and a `0.1` traces sample rate. Browser reporting is configured on web. The extractor receives only its allowed runtime Sentry settings, including the DSN; do not copy the main worker's full variable set or its source-map upload token into the credential-thin service. All three deployments reached `SUCCESS` after configuration.

The existing project alert emails suggested assignees, falling back to recently active members, when an issue becomes high priority. The [production uptime monitor](https://irmin-dw.sentry.io/monitors/2511365/) checks `https://thetimeline.cc/api/health` every minute with a five-second timeout. Three consecutive failures open an issue; one successful check resolves it. The health endpoint verifies Postgres connectivity. Its dedicated [availability alert](https://irmin-dw.sentry.io/monitors/alerts/1413143/) uses the same recipient policy for new, resolved, escalated, and regressed issues, with a 30-minute action throttle.

A synthetic informational message sent through the Node SDK with Railway's production configuration was confirmed in Sentry on 2026-10-24 with the `component=monitoring_smoke` tag. This verifies the SDK destination and ingestion; it does not simulate a production failure or prove email delivery. Web and worker still use the Node/Next Sentry SDKs, which default to Bun's Node compatibility version (`v26.3.0` on Bun 1.4). Server `beforeSend` stamps `contexts.runtime` to `bun` and the pinned Bun version so production issues show the Bun runtime after the Railway Bun start commands are live.

- Set `SENTRY_DSN` on web, main worker, and document-extract services, and `NEXT_PUBLIC_SENTRY_DSN` on the web service for browser errors.
- Set `SENTRY_ENVIRONMENT` to the deployment label you want alerts grouped by, such as `production`.
- Configure issue alerts and notification destinations in the Sentry project UI. The repo sends events; Sentry decides whether they page, email, or post to Slack.
- Set `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, and `SENTRY_PROJECT` in CI/deploy build environments that should upload source maps.

<span id="railway-tracing"></span>

### Railway request tracing

Railway tracing and automatic instrumentation are enabled for the production web and main worker services. The [Railway Traces view](https://railway.com/project/6a13f01d-6931-4fda-8790-b11d3192d5d8/traces?environmentId=351ba0c4-e8f5-41d7-b66d-0912d393c1e6) complements Sentry. Verification covered the public health request from edge to web to Postgres, and main-worker PostgreSQL, Redis, and HTTP client spans. Automatic instrumentation does not provide complete BullMQ job spans or trace propagation through every background operation. The extractor uses Sentry for failures; Railway tracing remains disabled there because its strict environment allowlist does not permit the injected OpenTelemetry exporter variables. Do not bypass that allowlist to enable tracing.

<span id="native-source"></span>

## 5. Native Sentry source

See [native source setup](sentry-source.md); this guide owns conversation/reliability setup.
