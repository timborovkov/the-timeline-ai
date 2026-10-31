# Polar team identity: verification and handoff

Date: 2026-10-30. Branch: `cursor/polar-usage-billing-4947`. API: `2026-10`.
No deployment, live migration, Railway configuration change, or local `.env` edit.

## Implementation

- One organization/environment-bound Polar team customer per Timeline team.
- Explicit owner identity; customer-scoped member mappings for authorized users.
- Explicit checkout customer ID and portal customer/member IDs; no email lookup.
- Shared resolver covers self-service/Enterprise checkout, portal fallback,
  subscription mutations, webhooks, and deferred usage delivery.
- Durable revocation intent, account locking, ownership transfer and revocation
  before local role removal. Retry the same action after an outage/interruption.
- Conversion defaults to dry-run and requires a verified platform admin. Mapping
  changes commit before payment links. Unrelated customers remain untouched.

## Official evidence

- [Team customer schema](https://github.com/polarsource/polar-js/blob/main/src/models/components/customerteamcreate.ts)
- [Customer conversion schema](https://github.com/polarsource/polar-js/blob/main/src/models/components/customerupdate.ts)
- [Member role schema](https://github.com/polarsource/polar-js/blob/main/src/models/components/memberrole.ts)
- [Customer-scoped member API](https://github.com/polarsource/polar/blob/main/server/polar/member/endpoints.py)
- [Customer service / email update and sandbox recipients](https://github.com/polarsource/polar/blob/main/server/polar/customer/service.py)

Organization read succeeded with the existing sandbox token and a normal client
User-Agent. `member_model_enabled` was true. The earlier plain-text 403 was a
client rejection, not evidence that organization permissions were absent.
Customer/member read/manage, checkout create, customer-session create and usage
write were exercised. An organization token rejects `organization_id` in the
create body; the implementation validates the configured organization and retries
only that specific error without the field.

## Isolated sandbox fixtures

Only authorized controlled owner/admin inboxes were used. No tokens, portal URLs,
checkout secrets, or inbox addresses are stored in this evidence file.

| Fixture | Customer ID |
| --- | --- |
| Team A | `0f67f91a-4464-42ee-9fa3-57bdcbeda818` |
| Team B, same owner | `17eb61d5-79d8-48eb-927b-b7e445ed1d10` |
| Individual-to-team conversion | `768c721b-d1c4-405b-a908-301beef7dbcb` |

Confirmed:

- Two team customers share the owner's email via separate owner members; customer
  emails remain null. Customer-scoped owner external IDs can be reused.
- Repeated checkout creation binds each checkout to its intended customer ID.
- The actual shared provider reuses the exact customer, rejects a cross-team ID,
  creates a billing-admin member/session, and delivers an isolated usage event.
- Owner and admin portal sessions initially return the intended customer (200).
  Deleting the admin member returns 204; its existing session then returns 401.
  The owner's existing session continues to return 200.
- Conversion preserves customer ID and creates an owner member whose legacy
  external ID is retained in the local mapping model.
- Polar accepts `email: null` on conversion cleanup but returns the original
  email. The implementation now detects this and reports
  `customer_email_clear_unsupported`; it does not claim complete cleanup or
  discard the converted mapping. This requires a provider fix.

Both sandbox checkouts completed using Stripe's standard test card. Team A has
subscription `de45aaa2-1261-426e-b868-61f53abda8f2` and paid order
`2c76d7eb-9444-400a-af83-6a858e1d6b77`; Team B has subscription
`d4ee3cb8-2e68-4ec3-b3ec-53a631e14895` and paid order
`6104f088-2beb-43d8-8789-98af630e0d1b`. Both invoices were generated through the
supported endpoint (202) and subsequently retrieved (200). Both team customer
emails remained null after payment. The Team B admin can read its order (200)
but cannot read Team A's order (404). A post-subscription usage ingest reported
one insertion; the customer-scoped event list showed that event for Team A and
zero matching events for Team B.

Mailbox delivery cannot be inferred from successful API requests.
Polar sandbox filters notification recipients to organization members (including
recognized aliases); controlled inbox ownership alone does not override that rule.

## Release procedure and documentation audit

Apply migration `0091_polar_team_identity.sql` in the selected environment before
running this code. Review each existing mapping with `billing:polar-convert`
dry-run, then apply individually. Never reuse a mapping across Polar environments.
Pending revocation rows must be completed by retrying the original role/removal
action; manually clearing intent can restore access and is not a recovery method.

The repository's `/document-release` skill is unavailable in this environment.
A manual diff/documentation audit covers README, design, TODO, setup/Polar,
Railway guidance, product brief, billing ADR, security/privacy trust, and relational
memory. No architecture changes to retrieval, extraction or relational memory.
No replacement global billing/discount variable was introduced.


## Webhook isolation incident and deployment hold

The existing sandbox organization sends webhooks to the deployed Timeline app.
A subscription event for the descriptive fixture external ID triggered Sentry
issue 157533396 on deployed release `d07d8266`: the old handler passed the string
to a PostgreSQL UUID query. That query failed before attribution or mutation.
This was caused by the sandbox test, not a push of this implementation.

The new handler validates external-ID UUID syntax before database access and
ignores unrelated event types. A regression test makes any database access fail
and verifies malformed/string/object fixture IDs are acknowledged without queries.
An isolated, schema-free hotfix is prepared as commit `707bb5de` on local branch
`codex/polar-webhook-uuid-guard`. The user confirmed that pushing the Polar branch auto-deploys. On 2026-10-31,
the user authorized syncing with main and pushing the full PR, including that
automatic deployment. The integrated implementation includes the webhook guard;
the isolated hotfix does not need a separate rollout. No global webhook or
environment configuration was changed.

Fixture cleanup is pending the guard deployment: canceling/deleting these exact
fixtures can generate more deliveries to the same old handler. Further sandbox
mutations are paused. Before future sandbox testing, inspect webhook destinations
and arrange an isolated consumer; sandbox account isolation does not isolate
configured webhook destinations.

## Validation results

- 148 focused synthetic tests passed across billing actions, team mutations,
  email verification, identity service/API, checkout discounts, Enterprise
  operator store and webhook suites. Database tests used disposable PGlite
  migrations; they did not touch a live database.
- Focused ESLint and TypeScript checks passed, including conversion/operator
  scripts. The final full `bun run build` passed (all four build tasks).
- `bun run test:dist-imports` passed for compiled shared-package boundaries.
- The schema-free hotfix separately passed its no-database-access regression,
  shared TypeScript check and focused lint. The original implementation checks preceded any push or deployment.
- Invoice generation/retrieval was verified; inbox delivery and real deployed
  Timeline webhook-to-entitlement processing were not verified. The sandbox
  consumer isolation issue prevents claiming that end-to-end rollout check.


## Main synchronization (2026-10-31)

Merged main's public trust/navigation update, retaining both Pricing and Trust.
Resolved the design documentation conflict and updated the navigation assertion
to the combined six-item menu. The merged navigation, legal-state, trust-claim,
LLMs text and malformed-webhook tests pass. The push is authorized with awareness
of branch auto-deployment; fixture cleanup follows confirmation that the guard
is deployed. The manual documentation handoff audit was refreshed for this merge.

## Review follow-up (2026-10-31)

- First-time customer setup between revocation preparation and local completion
  now causes completion to fail closed when a remote billing member remains.
  Retrying the membership action revokes the member before local access changes.
- Conversion preflight and execution use the same owner-resolution helper.
  An interrupted conversion can recover exactly one verified active owner by
  email within the verified customer; ambiguous matches or conflicting stored
  mappings stop. Member external IDs remain immutable.
- A retained legacy customer email is not harmless historical metadata. Polar's
  [customer service](https://github.com/polarsource/polar/blob/main/server/polar/customer/service.py)
  includes it in billing recipients and creates customer-scoped access links
  independently of member sessions. Revocation now attempts verified cleanup
  before member changes and remains pending if Polar ignores the update. No
  owner member email is removed. This explicitly addresses the suggestion to
  silently accept retained email without weakening revocation.
- Synthetic tests exercise the setup/removal interleaving, interrupted conversion
  recovery, ambiguous/conflicting owner recovery, and legacy-email revocation
  refusal/retry. No real customer reset, subscription, or payment is involved.

The [PR review audit](polar-review-audit.md) records the disposition and implementation/test evidence for the historical billing review backlog.

The second review cycle additionally covers remote provisioning surviving a local
rollback, missing-provider recovery, and checkout decisions using the final locked
account. Organization/environment intent is durable before external writes; local
removal cannot complete from an unconfirmed revocation phase.

Revocation and ownership transfer now apply the same pinned member/external-ID
validation as session synchronization. Swapped or ambiguous mappings fail before
provider deletion/promotion, with regressions for both targets and successors.


### Checkout return feedback (2026-10-31)

The billing route previously ignored `checkout=success`, leaving a stale Free plan without
feedback while subscription activation depended on webhooks. The return UI now refreshes
for at most thirty seconds, confirms only persisted active subscription state matching the
selected plan, and provides a delayed-confirmation retry message. Checkout buttons are
disabled while confirmation is pending. New return links carry team/plan UI hints, never
entitlement authority. The unused customer session token is removed from browser history.

Synthetic coverage checks bounded polling, manual retry, activation after refreshed props,
credential removal, pending checkout suppression, and requested-plan matching. The user subsequently confirmed all subscription webhooks returned HTTP 200 with
`{"ok":true}`, and a full reload showed Pay as you go. That confirms activation
completed; the reported issue was stale return UI, not a missing subscription.
The sandbox customer lookup from this execution environment still returned HTTP 403.

Documentation handoff: reviewed setup, billing ADR, README, design and TODO implications.
No billing identity or entitlement contract changed. Updated the setup troubleshooting and
this evidence log. The repository's referenced document-release skill is unavailable here.

Verification: 26 focused tests passed across checkout actions and the two billing UI
suites. Full repository build, scoped ESLint, formatting and diff checks passed.


### PAYG usage and spend-cap clarity (2026-10-31)

Paid plans now retain zero-usage meters. Free and PAYG display each native monthly
allowance and its remaining amount; Team/Business do not display those native
allowances because their included invoice credit is a different benefit. PAYG's
€25 default is labeled as a spend cap, not credit or an upfront charge, in usage,
billing and sidebar context. Extra member pricing remains visible.

Dashboard meters now expose existing cap-eligible counters alongside gross usage
values. The charge column uses these counters, preventing earlier Free activity
from appearing as a charge after upgrading. No pricing, allowance, cap-setting or
settlement rules changed. Comps continue to show usage without Polar charges.
Regression coverage includes zero meters, remaining/exhausted allowances, Free
activity with zero chargeable spend, comped usage, and explicit cap labels.

Verification: focused usage/billing UI, billing status, charge and database-backed
billing-scope suites passed, including the Free-to-PAYG dashboard regression.
Full repository build, scoped lint/formatting, compiled-import and diff checks
passed. Setup and testing documentation updated; no environment variables,
provider configuration, or customer billing records changed.

### Shared benefits and recorded charges (2026-10-31)

Usage, Billing and sidebar now consume the same typed presentation model. The
read-only dashboard transaction provides a consistent snapshot of counters,
credit balance and settlement records. Free/PAYG native allowance resets and cap
progress use the UTC calendar month; pooled credit and recorded paid charges use
subscription boundaries. Missing/stale credit windows are Updating billing
period, without a read-side refill. Charges with ambiguous historical attribution
or missing evidence for consumed credit are Unavailable.

The former Next invoice display was a hypothetical plan comparison. It is replaced
with recorded usage charges, credit applied, extra members, and a separately
labeled recurring fee. Plan comparisons are explicitly labeled. Renewal-spanning
settlements retain invoice cents beside each discount window. Additive metadata
marks chargeability/comp status; no charging or enforcement calculations change.
Comps do not accrue new Polar charges, while previously paid charges remain
visible. Codex finding discussion_r4431309636 is addressed by retaining paid
cap-eligible meter charges after downgrade to Free and preserving settlement
history across plan/arrangement changes.

The presentation requires a verified owner/admin role even when the caller asks
for financial details. Member sidebar summaries carry no presentation model.
Synthetic coverage includes Free/PAYG allowances, Team/Business credit, separate
periods, overrides, members, caps, late records, renewal splits, unavailable data,
comps and downgrades. Desktop and 320px Chromium checks across all five plans found
no horizontal overflow; Team/PAYG screenshots were inspected locally.

Documentation handoff: updated design, setup, billing ADR, TODO and this evidence
log. README/product brief require no changed contract or setup instructions. The
referenced document-release skill remains unavailable; this is its manual handoff.

Final verification: 182 distinct focused cases passed, including 80 database-backed
billing scope tests and 12 presentation-model cases. The full repository build,
scoped ESLint/formatting, compiled import checks, diff checks and five-plan
Chromium desktop/320px overflow checks passed. No environment variables, billing
records or provider configuration changed.
