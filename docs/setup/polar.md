# Polar billing setup

Configure Polar as merchant of record for the shared billing catalog. [The billing contract](../architecture/billing.md) owns admission, settlement, customer identity and webhook ordering. This guide owns operator steps.

## Environment and prerequisites

Use separate sandbox and production organizations, tokens, customers and webhook endpoints. A sandbox webhook pointed at production still delivers to production; `POLAR_SERVER` does not make an arbitrary incoming payload a sandbox event. Use disposable authorized fixtures for verification.

Enable the organization's member model. The organization token needs organization read, customer/member read and management, checkout/session/subscription operations, usage-event write and product/discount reads required by the setup/runtime commands. Verify permissions against the installed SDK/API; do not broaden scopes speculatively.

Configure web and ordinary worker services:

```dotenv
POLAR_ACCESS_TOKEN=
POLAR_SERVER=sandbox
POLAR_ORGANIZATION_ID=
POLAR_WEBHOOK_SECRET=
POLAR_WEBHOOK_ID=
POLAR_PRODUCT_ID_TEAM=
POLAR_PRODUCT_ID_ENTERPRISE=
BILLING_CHARGES_ENABLED=false
PLATFORM_ADMIN_EMAILS=
```

The document-extract orchestrator remains credential-thin: it needs the applicable billing gate, not Polar credentials. Platform administration requires an already-verified allowlisted user; it is not a team role. See [platform administration](../platform-admin.md).

## Provisioning products and meters

Configure USD as the selected Polar organization's default presentment currency before provisioning. Polar requires every product to include a price in the organization's default currency, and Timeline provisions a USD-only catalog. Setup checks this through the organization read API before planning or writing any changes.

Run `bun run billing:polar-setup` with the selected environment configured. Sandbox requires an explicit `--webhook-url` on an isolated host. Review its output before applying printed identifiers to services. It reconciles the monthly USD Team seat price, custom Enterprise offer, usage prices and selected webhook; it must not mutate unrelated products/endpoints. Do not manually create provider meters for product capacity gates.

The shared catalog owns current prices, commitments, member rates and allowances. Reconcile the setup output with that catalog rather than copying a dated price list. The Team product uses one seat price starting at one seat and two metered prices for AI and native capture. The application applies Included usage and the approved cap before recording invoice usage. Local storage/free allowances must not also be credited by Polar. If historical provider credits differ, review the account and schedule an explicit correction; do not change production pricing as an incidental setup task.

The setup flow can archive superseded Timeline offers and legacy top-ups. For end-to-end sandbox testing, dry-run against a dedicated sandbox organization before authorizing writes. Use a fixture-only HTTPS webhook and database. Verify the planned organization, product changes, and endpoint before applying the plan. There is no auto-reload or prepaid-wallet configuration to add. Configure campaigns in Polar and assign per-team discounts/overrides through the audited operator interface; do not add global discount environment variables or modify historical usage.

## Webhook

Deploy `POST /api/webhooks/polar` before registering deliveries. Use Standard Webhooks signing with the configured `whsec_` secret. The setup command owns the endpoint event list. Subscription events drive entitlements. Refund deliveries currently do not change entitlement or reverse usage in Timeline. Inspect delivery failures and the deployed revision if events do not apply; do not mark a team paid from a checkout return URL.

The handler validates signature/replay time, body bounds, team identity and provider ordering. Configure webhook isolation deliberately: production and sandbox endpoint routing must agree with the intended database/customer mappings. Retain sanitized delivery IDs and errors for retries, never tokens or full payment payloads.

## Existing customer conversion

Apply the checked-in migrations before conversion. Use the verified platform-admin actor and team-specific dry run:

```sh
bun run billing:polar-convert --team-id=<uuid> --actor-email=<verified-platform-admin>
```

Review customer organization/environment, existing mapping and owner identity before adding `--apply`. The command performs in-place customer/member conversion and preserves mappings before payment links. It must not reset a customer or reassign unrelated records. Retry the same command to recover interrupted operations.

The October 2026 sandbox accepted `email: null` while retaining a legacy customer email. The command detects `customer_email_clear_unsupported`; [the evidence record](../evidence/polar-team-identity-2026-10.md) explains the access risk. Provider-supported cleanup is required before claiming independent customer-level access is removed. An owner member retaining their own email is expected and is a separate concern.

## Recovery and support

- A delayed checkout return is pending until a verified subscription webhook updates the stored plan. Retrying an unchanged Team quote can recover its original payable link. If the roster or discount changed, wait for Polar to mark the previous checkout expired or failed. Polar has no merchant checkout-expiration operation.
- Maintenance checks the recorded subscription for missed seat updates. It can reconcile confirmed quantities and schedule reductions. A roster larger than the confirmed quantity requires a billing administrator to review the subscription before adding members.
- Inspect missing-price/unbilled alerts in `/app/admin/billing`; reconcile catalog configuration and retry delivery without deleting the ledger.
- Resume pending membership revocation or conversion through the original operation; never clear pending intent to unblock access.
- Comp/Enterprise changes use `/app/admin/billing` or `bun run billing:operator`; cancellation/checkout failures must resolve before a comp can replace paid state.
- Keep spend-cap dates separate from subscription credit renewal, and recorded charges separate from final invoices.

## Verification and release

Before enabling `BILLING_CHARGES_ENABLED`, retain dated evidence for the deployed revision, environment/customer mapping, real webhook delivery, member portal isolation/revocation, cancellation and recovery, and a shadow reconciliation period including invoice totals. The roadmap calls for a shadow-billing month; source tests alone do not close that operating gate. Use synthetic authorized accounts, not customer fixtures.

Provider/legal readiness is tracked in [security gaps](../security-gaps.md). Account settings and invoices must be checked live before asserting they are correct; this guide is not deployment evidence.
