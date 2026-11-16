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
POLAR_PRODUCT_ID_PAYG=
POLAR_PRODUCT_ID_TEAM=
POLAR_PRODUCT_ID_BUSINESS=
POLAR_PRODUCT_ID_ENTERPRISE=
BILLING_CHARGES_ENABLED=false
PLATFORM_ADMIN_EMAILS=
```

The document-extract orchestrator remains credential-thin: it needs the applicable billing gate, not Polar credentials. Platform administration requires an already-verified allowlisted user; it is not a team role. See [platform administration](../platform-admin.md).

## Provisioning products and meters

Run `bun run billing:polar-setup` with the selected environment configured. Review its output before applying printed identifiers to services. It creates/reuses Timeline-owned products, all catalog meters and the selected webhook; it must not mutate unrelated products/endpoints. Do not manually create provider meters for product capacity gates.

The shared catalog owns current prices, commitments, member rates and allowances. Reconcile the setup output with that catalog rather than copying a dated price list. Local storage/free allowances must not also be credited by Polar. If historical provider credits differ, review the account and schedule an explicit correction; do not change production pricing as an incidental setup task.

Legacy Timeline top-up products are retired by the supported setup flow. There is no auto-reload or prepaid-wallet configuration to add. Configure campaigns in Polar and assign per-team discounts/overrides through the audited operator interface; do not add global discount environment variables or modify historical usage.

## Webhook

Deploy `POST /api/webhooks/polar` before registering deliveries. Use Standard Webhooks signing with the configured `whsec_` secret. The setup command owns the endpoint event list, including subscription lifecycle, paid/refunded orders and refund events. Inspect delivery failures and the deployed revision if events do not apply; do not mark a team paid from a checkout return URL.

The handler validates signature/replay time, body bounds, team identity and provider ordering. Configure webhook isolation deliberately: production and sandbox endpoint routing must agree with the intended database/customer mappings. Retain sanitized delivery IDs and errors for retries, never tokens or full payment payloads.

## Existing customer conversion

Apply the checked-in migrations before conversion. Use the verified platform-admin actor and team-specific dry run:

```sh
bun run billing:polar-convert --team-id=<uuid> --actor-email=<verified-platform-admin>
```

Review customer organization/environment, existing mapping and owner identity before adding `--apply`. The command performs in-place customer/member conversion and preserves mappings before payment links. It must not reset a customer or reassign unrelated records. Retry the same command to recover interrupted operations.

The October 2026 sandbox accepted `email: null` while retaining a legacy customer email. The command detects `customer_email_clear_unsupported`; [the evidence record](../evidence/polar-team-identity-2026-10.md) explains the access risk. Provider-supported cleanup is required before claiming independent customer-level access is removed. An owner member retaining their own email is expected and is a separate concern.

## Recovery and support

- A delayed checkout return is pending until a verified subscription webhook updates the stored plan. Ask the user to check again rather than creating another checkout.
- Inspect missing-price/unbilled alerts in `/app/admin/billing`; reconcile catalog configuration and retry delivery without deleting the ledger.
- Resume pending membership revocation or conversion through the original operation; never clear pending intent to unblock access.
- Comp/Enterprise changes use `/app/admin/billing` or `bun run billing:operator`; cancellation/checkout failures must resolve before a comp can replace paid state.
- Keep spend-cap dates separate from subscription credit renewal, and recorded charges separate from final invoices.

## Verification and release

Before enabling `BILLING_CHARGES_ENABLED`, retain dated evidence for the deployed revision, environment/customer mapping, real webhook delivery, member portal isolation/revocation, cancellation and recovery, and a shadow reconciliation period including invoice totals. The roadmap calls for a shadow-billing month; source tests alone do not close that operating gate. Use synthetic authorized accounts, not customer fixtures.

Provider/legal readiness is tracked in [security gaps](../security-gaps.md). Account settings and invoices must be checked live before asserting they are correct; this guide is not deployment evidence.
