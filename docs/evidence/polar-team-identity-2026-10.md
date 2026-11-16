# Polar team identity: dated sandbox evidence

Observed October 30–31, 2026 on the billing branch against API 2026-10. This is not a current deployment assertion. [Polar setup](../setup/polar.md) owns procedures; [billing architecture](../architecture/billing.md) owns invariants.

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

## Webhook isolation incident and deployment hold

The existing sandbox organization sends webhooks to the deployed Timeline app.
A subscription event for the descriptive fixture external ID triggered Sentry
issue 157533396 on deployed release `d07d8266`: the old handler passed the string
to a PostgreSQL UUID query. That query failed before attribution or mutation.
This was caused by the sandbox test, not a push of this implementation.

The handler validates Polar team identifiers (customer `external_id`,
`external_customer_id`, and `metadata.team_id`) as UUIDs before any database
access, including the `team_billing_accounts` `SELECT … FOR UPDATE`. Invalid
identifiers and unknown Timeline teams are acknowledged with HTTP 2xx so Polar
stops retrying; the webhook route reports a throttled handled warning
(`reportHandledEvent`) instead of a 500. A regression test makes any database
access fail and verifies malformed/string/object fixture IDs, including
sandbox `timeline-identity-test-…` metadata, are acknowledged without queries.
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
