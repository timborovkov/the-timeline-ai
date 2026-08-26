# Privacy and analytics implementation interface

| Field | Value |
| --- | --- |
| Status | Normative target; runtime implementation and production evidence pending |
| Applies to | Public Timeline routes, authenticated product routes, web/server/worker analytics, consent UX, PostHog, aggregate counters, and Sentry boundaries |
| Normative parent | [Security, privacy, and trust operating standard](./security-privacy-trust.md) |
| Legal research | [GDPR, cookies, and consent audit](./research/gdpr-cookie-consent-audit-2026-08-21.md) |
| Runtime owner | Analytics implementation branch |
| Privacy owner | **TBD: product privacy** |
| Version | 2026-08-21 |

This document is the handoff contract between privacy policy and analytics
implementation. It defines the target behavior and evidence needed to call that
behavior enforced. It does **not** claim that the current worktree, a deployment,
or a provider account already satisfies the contract.

If runtime code, provider settings, setup documentation, public copy, or this
interface disagree, apply the more private behavior and leave the relevant gap
open until the disagreement is reviewed.

## 1. Required data paths

Timeline has five distinct measurement and reliability paths. Consent or data
from one path must not silently authorize another.

| Path | Surface | Consent state | Permitted behavior | Identifier boundary |
| --- | --- | --- | --- | --- |
| Aggregate public request counts | Allowlisted public HTTP routes, measured server-side | Always on | Increment pre-aggregated, coarse route/time/status counters | No user, team, device, session, cookie, request, IP, user-agent, referrer, or PostHog identifier |
| Optional public browser analytics | Allowlisted public pages only | Off until affirmative analytics consent | Explicit, allowlisted browser events and properties | A provider-generated pseudonymous identifier may exist only after opt-in; never identify or alias it to an account, user, or team |
| Private workspace browser | Authenticated/private application route tree | Not applicable | Browser analytics code must not load, initialize, identify, capture, or fetch analytics-backed feature flags | No browser PostHog identifier or event is created from private-route activity |
| Authenticated product analytics | Explicit server actions, API handlers, jobs, and workers | Separate from browser consent | Named, content-free, schema-validated server/worker events only | Default to no identifier; an opaque user/team identifier is allowed only when the approved event contract requires correlation |
| Sentry reliability monitoring | Public or private routes where configured | Separate from analytics consent | Minimized error and performance diagnostics under section 10 of the parent standard | No analytics profile, replay, marketing use, or PostHog identity bridge |

Declining optional browser analytics does not disable or change the
identifier-free aggregate public request counts. The consent interface must say
this clearly enough that a visitor does not believe **Reject** stops essential,
aggregate service measurement.

## 2. Route boundary

The implementation must maintain a source-controlled public-route allowlist.
Only an allowlisted route may use aggregate public counters or consented browser
analytics. An unknown or newly added route defaults to private: no browser
analytics load or capture occurs until the route is reviewed and allowlisted.

The private boundary includes:

- every authenticated workspace, team, board, timeline, document, meeting,
  search, agent, settings, billing, and integration route;
- authenticated API and Server Action activity;
- invitation, password-reset, email-verification, legal-acceptance, and other
  account-entry surfaces that can expose a person's account state; and
- any route containing customer, account, support, or restricted data, even if
  the route can technically render before authentication.

Static marketing, pricing, public Trust/legal content, and genuinely public
guides may be allowlisted. Public support or signup forms remain excluded from
browser analytics unless privacy review explicitly approves a content-free
event contract; Turnstile and transactional form processing are separate data
paths.

Route classification is based on data exposure and purpose, not whether a URL
is reachable without signing in.

## 3. Identifier-free aggregate public request counts

This path is an always-on, server-side operational count. It must not depend on,
read, write, or infer browser consent. It must not load a client SDK or create a
browser identifier.

Allowed dimensions are intentionally coarse:

- an allowlisted route template or route group with parameters removed;
- a bounded time bucket;
- HTTP method class only when needed;
- response status class; and
- a small, source-controlled deployment or locale dimension only after privacy
  review.

Prohibited input and output include raw or hashed IP addresses, user agents,
cookies, authorization state, request IDs, referrers, query strings, URL
parameters, precise timestamps, device/browser fingerprints, geolocation,
account/user/team IDs, PostHog distinct IDs, and any customer or form content.
Hashing one of these values does not turn it into an aggregate count.

The implementation must aggregate before persistence or export. It must not
create a row or third-party event for each visitor request and later call the
result aggregate. If an analytics provider requires a synthetic `distinct_id`
for each count, that provider path does not satisfy this contract.

Infrastructure access logs are a separate security/operations data path. Their
possible receipt of ordinary request metadata does not permit copying that
metadata into aggregate analytics, and their retention and access remain
subject to the logging rules and evidence gaps in the parent standard.

## 4. Optional public browser analytics

Browser analytics is optional and fail-closed.

Before affirmative consent, and after rejection or withdrawal, the browser
must make zero PostHog analytics requests and create zero PostHog identifiers or
storage. Merely configuring a provider token, importing a module, rendering a
consent banner, visiting another route, scrolling, or continuing to use the
site is not consent.

After affirmative consent, only manual, named events on allowlisted public
routes may be emitted. Each event requires a source-controlled schema and owner.
The schema may use stable enums, booleans, bounded counts, coarse durations,
content types, and allowlisted route groups. It must not contain:

- names, emails, account IDs, team IDs, or integration identifiers;
- raw URLs, paths with identifiers, queries, fragments, referrers, or search
  text;
- form values, support content, filenames, prompts, outputs, documents,
  transcripts, or other customer content;
- cookies, authorization values, headers, signed URLs, IP/geolocation
  properties, or device fingerprint components; or
- arbitrary spread objects, error objects, DOM text, or provider-default
  properties outside the allowlist.

The public browser identity must remain pseudonymous and isolated. The
implementation must never call PostHog `identify`, `alias`, or group-assignment
behavior with an account, user, team, email, or other lookup value. Signing in
must not connect a consented public-site identity to authenticated analytics.

Autocapture, automatic pageview/pageleave capture, heatmaps, surveys that record
page content, session recording/replay, DOM capture, frustration signals, and
client-side feature-flag analytics are prohibited. If a public pageview is
needed, it must be an explicit allowlisted event emitted only after consent with
an allowlisted route group rather than the raw URL.

## 5. Consent interface

The consent UX must implement these behaviors:

1. Optional analytics is off by default. No optional script, network request,
   storage, or identifier occurs while the choice is unknown.
2. The first layer offers equally clear **Accept analytics** and **Reject**
   actions. Neither is preselected or visually disguised.
3. The explanation distinguishes optional public browser analytics from the
   always-on identifier-free aggregate public request count.
4. Declining has no effect on public content, signup, authentication, invitations,
   or authenticated product capability.
5. A persistent, easy-to-find privacy-preferences control allows withdrawal.
   Withdrawal is as easy as acceptance and takes effect before another browser
   analytics event.
6. Rejection or withdrawal clears any optional first-party PostHog storage and
   resets provider state. It does not delete the strictly necessary consent
   choice needed to remember rejection.
7. A minimal first-party consent record may contain the consent-interface
   version, analytics choice, and timestamp. It must not contain a PostHog,
   account, user, team, or device identifier when analytics is rejected.
8. A material change in public browser purpose, provider, data contract, or
   identity behavior invalidates the old opt-in and requires a new affirmative
   choice.

The Privacy Policy and Cookies and similar technologies notice explain the
processing. Showing, linking, accepting, or acknowledging either notice is not
analytics consent. Terms acceptance is also separate. Consent must be recorded
as the user's optional, purpose-specific choice, and it must remain withdrawable
without loss of the core service.

## 6. Authenticated product analytics

Authenticated product measurement is server/worker-only. Browser components on
private routes must not import or call PostHog, forward browser analytics
payloads to an internal API, or use an analytics SDK for feature flags.

Every authenticated event requires:

- an explicit event name, business purpose, owner, and retention expectation;
- an exact property schema with runtime rejection of unknown properties;
- a call at a named server action, API decision, durable job, or worker outcome,
  not a generic request/page middleware;
- content-free properties limited to stable enums, booleans, bounded counts,
  coarse durations, byte sizes, content types, provider/model identifiers, and
  a success/failure category;
- no names, emails, URLs, queries, filenames, titles, prompts, outputs,
  transcripts, documents, object text, headers, secrets, or arbitrary errors;
  and
- a documented legal basis and public disclosure independent of browser
  consent.

Identifiers are exceptional, not default. Where a reviewed event genuinely
needs adoption or deduplication across actions, it may include only the minimum
opaque user or team identifier named in its schema. It must not include a
lookup property such as email or name, and it must not connect to the optional
public-browser identity.

The server/worker path must not be described as anonymous merely because it is
content-free or pseudonymous. Browser rejection does not authorize this path;
its authority comes from its separately documented purpose and legal basis.

## 7. Sentry remains separate

Sentry is reliability and security monitoring, not product analytics. The
analytics-consent state must not be sent to Sentry as a user profile and must
not control PostHog through Sentry or Sentry through PostHog.

Sentry may be initialized where its separate necessity, legal-basis, provider,
retention, and scrubber review permits. It must keep session replay disabled,
default PII collection disabled, production sampling minimized, secret-bearing
headers and URLs scrubbed, and unexpected event payloads sampled and audited.
It must not receive customer content merely because an exception included it.

G-11 in the parent standard remains open independently of browser analytics
acceptance and independently of G-10.

## 8. Acceptance evidence

The analytics implementation branch must provide repeatable evidence for all of
the following before the target moves from **Required** to **Enforced**:

| Scenario | Required observation |
| --- | --- |
| New browser, public route, no choice | Aggregate counter increments; no PostHog script/request/cookie/local storage/IndexedDB/service-worker state or identifier |
| New browser, reject | Same aggregate behavior; zero browser PostHog capture and identifier; rejection persists |
| New browser, accept | Aggregate behavior is unchanged; only allowlisted public events/properties are sent |
| Withdraw after accepting | Capture stops before the next event; optional PostHog state is reset/cleared; rejection persists |
| Direct private-route load after prior public opt-in | No browser analytics module, request, initialization, identification, capture, or analytics flag request |
| Public-to-private navigation | No private-route activity reaches browser analytics and no public identity is linked to an account |
| Authenticated product action | Only the explicit schema-valid server/worker event is eligible; no browser event is emitted |
| Unknown/new route | Defaults to no browser analytics and no aggregate route dimension until allowlisted |
| Disallowed property or arbitrary object | Runtime rejects it; the provider receives nothing |
| Sentry event | Follows the separate scrubbed reliability path and creates no PostHog event or identity |

Evidence must include focused automated tests, a clean-profile browser network
and storage inspection, the event/property registry, provider configuration
screenshots or exports, and a dated production canary. Test fixtures use
synthetic data.

Provider evidence must additionally cover project region, retention,
IP/geolocation handling, person-profile settings, access control, DPA,
subprocessors/transfers, deletion, and the disabling of autocapture, automatic
page views/page leave, heatmaps, replay, and unreviewed feature flags.

## 9. Status and ownership handoff

| Item | Current state | Owner |
| --- | --- | --- |
| This normative interface | **Required** | Privacy documentation owner |
| Runtime route split, aggregate counter, consent UX, PostHog initialization, server/worker event path, setup-guide correction, and tests | **Gap / pending implementation**. The Railway guides currently instruct operators to set the public PostHog key and must be corrected before deployment. | Analytics implementation branch |
| Legacy Convex pageview code, deployment, logs, token URLs, and deletion/rotation review | **Gap** | Analytics implementation branch with security owner |
| PostHog account configuration, contract, retention, transfer, deletion, and production evidence | **Gap** | Product privacy/vendor owner with analytics implementation branch |
| Sentry account and scrubber evidence | **Gap**, separate from analytics | Reliability owner |
| Public claims and legal/cookie copy | Qualified current-gap and target disclosures may publish; any claim that the target is deployed or enforced, or any unverified retention or anonymity claim, is blocked until implementation and provider evidence pass | Privacy/legal owner |

The privacy-documentation owner owns this contract and the status language in
the parent standard. The analytics implementation branch owns runtime code,
configuration, environment variables, consent components, event registries,
provider initialization, analytics tests, analytics setup documentation, and
the evidence bundle. This documentation change intentionally does not edit or
approve those implementation surfaces.

The implementation branch may make behavior more private without coordination.
It must not broaden routes, identifiers, properties, capture modes, provider
features, or consent assumptions without privacy review and a same-change
update to this interface. It must return the acceptance evidence above before
requesting that G-03 or G-10 be closed or that a target behavior become a public
claim.
