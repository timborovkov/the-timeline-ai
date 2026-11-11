# Analytics setup

> PostHog Cloud EU is the only product and website analytics provider. Sentry remains a separate reliability service. Do not add advertising pixels, session replay, heatmaps, or another analytics vendor without a new privacy review.

Timeline separates personless surface-request totals, consented public-browser analytics, and pseudonymous server/worker product events. No path may send Customer Content.

<span id="project"></span>

## 1. Project and environment

1.  Create or select a PostHog Cloud EU project.
2.  Prefer the free plan for launch. If the founder keeps pay-as-you-go to retain platform features, document the decision, monitor the free allowance, and set an approved hard billing limit before production traffic can create overage charges.
3.  Disable IP/geolocation enrichment, person profiles, autocapture, automatic page views, session replay, heatmaps, surveys, error tracking, and unreviewed feature flags.
4.  Use the shortest practical event retention; the product target is 90 days. PostHog's documented product-event retention is one year on Free and seven years on Pay-as-you-go, with no 90-day project control found in the 2026-08-26 review. Resolve or explicitly approve that mismatch before production enablement.

<!-- -->

    # Server and worker capture. Keep these private.
    POSTHOG_PROJECT_KEY=phc_...
    POSTHOG_HOST=https://eu.i.posthog.com
    ANALYTICS_PSEUDONYMIZATION_KEY=<independent high-entropy secret>

    # Optional public-browser capture. Leave the key empty to disable it.
    NEXT_PUBLIC_POSTHOG_KEY=
    NEXT_PUBLIC_POSTHOG_HOST=https://m.thetimeline.cc
    NEXT_PUBLIC_POSTHOG_UI_HOST=https://eu.posthog.com

Use a different pseudonymization key per environment. If that key is missing, correlatable product-action events fail closed instead of sending raw IDs. The public key is intentionally separate so server analytics can run while browser analytics remains disabled.

Public browser ingestion defaults to the PostHog-managed reverse proxy at `https://m.thetimeline.cc` when the host is unset or empty. Set `NEXT_PUBLIC_POSTHOG_HOST` at web build time to that origin, or to `https://eu.i.posthog.com` for direct EU ingestion. Existing explicit EU values override the default: update or remove them and rebuild the web image to use the proxy. The SDK dashboard host defaults to `https://eu.posthog.com`; override it with `NEXT_PUBLIC_POSTHOG_UI_HOST` at build time using an HTTPS URL without credentials. Other ingestion origins require a source allowlist review. Server and worker ingestion still uses the direct EU host.

Historical account observations are recorded in [analytics evidence](../evidence/analytics-observations-2026.md). Reverify the deployed route and provider state before claiming a working production rollout.

<span id="paths"></span>

## 2. Measurement paths

### Personless server surface requests

`public_surface_requested` and `app_surface_requested` use one fixed, non-visitor stream ID each. Their only variable property is a source-controlled surface key. They do not receive a URL, query, referrer, visitor IP, user agent, request/session ID, user ID, team ID, campaign value, or Customer Content. PostHog receives the server connection and GeoIP enrichment is disabled. Dashboard these events by total count only: unique users, sessions, retention, and returning visitors are deliberately meaningless.

The Node SDK adds only reviewed transport metadata: the project key, reserved stream ID, event name, server marker, SDK name/version, event UUID/timestamp, batch send time, and GeoIP-disable flag. A transport-level regression test pins that complete wire schema; none of those fields may be derived from the request.

These are surface requests, not verified human visits. Bots, refreshes, retries, framework behavior, and caching can affect totals. Unknown routes are not measured until explicitly reviewed and added to the registry.

### Optional public-browser analytics

The browser SDK may load only after affirmative analytics consent and only on an allowlisted public route. It emits manual `public_page_viewed` and `public_cta_clicked` events. It must never identify, alias, or group the browser identity to an account, user, or team. Rejecting or withdrawing stops capture and clears optional PostHog and campaign-attribution state.

<span id="website-traffic"></span>

### Visitors, pageviews, referrers, and popular pages

Open [PostHog Web analytics](https://eu.posthog.com/project/245318/web). After consent, `PublicAnalyticsBoundary` emits one manual `$pageview` per reviewed public pathname visit through the public client, alongside the existing `public_page_viewed` event. Web analytics counts only `$pageview`. Client navigation and return visits count; rerenders and query-only changes do not. Sign-in, signup, support forms, private workspace routes, token-bearing paths, and unknown routes are excluded. Collection is not backfilled; consent choices and browser blockers affect coverage.

The send hook retains only a reviewed public HTTP(S) origin/path, its host/pathname, and the referring website origin/hostname. It removes query strings, fragments, referrer paths, titles, and SDK person metadata. GeoIP, person profiles, automatic capture, session recording, and browser account/team identification remain disabled. Consent format version 2 requires a fresh choice for this metadata; current legal versions are owned by `packages/shared/src/legal-versions.ts`. These fields are an explicit browser-pageview exception, not permission to send URL metadata on any other event.

Historical account observations are recorded in [analytics evidence](../evidence/analytics-observations-2026.md). Reverify the deployed route and provider state before claiming a working production rollout.

### Pseudonymous product-action analytics

Explicit server actions, API outcomes, and workers may emit schema-validated product events. Raw user/team UUIDs are transformed with HMAC before capture and never appear in event properties. Pseudonymous analytics remains personal data; do not describe it as anonymous. Browser consent neither authorizes nor disables this separately disclosed server processing.

<span id="contract"></span>

## 3. Event contract

The server/worker typed registry lives in `packages/shared/src/analytics/events.ts`. Each event has an owner, trigger, data class, exact runtime schema, and retention target. Add server events there before emitting them. The separate public-browser event and property allowlists are enforced in `apps/web/src/lib/public-browser-analytics.ts` under the browser contract above.

Allowed properties are stable enums, booleans, bounded counts, coarse durations and sizes, visibility classes, provider/model identifiers, and sanitized campaign dimensions. Never send names, emails, resource IDs, URLs, queries, filenames, titles, prompts, answers, transcripts, document text, cookies, authorization values, headers, arbitrary errors, secrets, or uploaded/workspace content.

Only consented manual browser `$pageview` events have the reviewed public-path and referrer-origin exception described above. All other schemas retain the URL exclusion.

Emit product events only after a successful meaningful action or durable job outcome. Page popularity belongs to the personless surface stream; do not add client click spam to the private application.

<span id="dashboard"></span>

## 4. Launch dashboard

Create one small dashboard named **Launch** with these insights:

1.  Registrations by week and sanitized first-touch campaign.
2.  Activated teams: first evidence plus a first value action within seven days of team creation.
3.  Weekly engaged teams: meaningful product actions on at least two distinct days, excluding login, onboarding, and surface-request events.
4.  Top public and app surfaces using event totals, never unique-user calculations.
5.  Feature-area adoption and agent request/input/output/total token volume.
6.  Time to first evidence and first answer.
7.  Total event volume compared with the free allowance.

Do not create a person, retention, or session insight from the two fixed personless streams. Consented browser events may be used for public-site sessions and returning-visitor analysis, but they must not be joined to registrations through a PostHog identity. Campaign properties on the registration event are the approved attribution boundary.

<span id="evidence"></span>

## 5. Release evidence

Run the [analytics acceptance matrix](../privacy-analytics-interface.md#8-acceptance-evidence) against the intended deployment and record dated results. [Security gaps](../security-gaps.md) owns unresolved provider/account/legal checks. No duplicate checklist is maintained here.
