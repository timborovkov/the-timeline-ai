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

Configure USD as the selected Polar organization's default presentment currency before provisioning. Polar requires every product to include a price in the organization's default currency, and Timeline provisions a USD-only catalog. Setup checks this through the organization read API before planning or writing any changes. For an Enterprise quote, check the amount and currency on Polar before sharing it. Billing shows the verified subscription currency for the recurring Enterprise fee and retains EUR for legacy fee records.

Preview the plan with `bun run billing:polar-setup --dry-run` in the selected environment. Sandbox requires an explicit `--webhook-url` on an isolated host. Review the proposed writes and archives before running without `--dry-run`. Production reads and writes require `--allow-production`. Apply the reported identifiers to the corresponding web and worker services.

Setup reconciles the monthly USD Team seat product, the custom Enterprise product and the selected webhook. It prices AI and native capture on those products. The application applies Team Included usage and any approved cap before recording invoice usage. Check the output against the [billing contract](../architecture/billing.md). If historical provider credits differ, review the account and schedule an explicit correction.

Setup can archive superseded Timeline offers and legacy top-ups. Inventory active legacy subscriptions before changing the catalog. Keep the optional `POLAR_PRODUCT_ID_PAYG` and `POLAR_PRODUCT_ID_BUSINESS` values where legacy subscriptions still use them. Reconcile active legacy Team and Enterprise subscriptions before switching those plans' configured product IDs, since the incoming subscription upsert uses one configured product ID per plan. Use a dedicated sandbox organization, fixture-only HTTPS webhook and disposable database for registered-delivery tests. Configure campaigns in Polar and assign per-team discounts or overrides through the audited operator interface.

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

- A delayed checkout return is pending until a verified subscription webhook updates the stored plan. Retrying an unchanged Team or Enterprise quote can recover its original payable link. If the roster, discount or negotiated terms changed, wait for Polar to mark the previous checkout expired or failed. Polar has no merchant checkout-expiration operation.
- Maintenance checks the recorded subscription for missed seat updates. It can reconcile confirmed quantities and schedule reductions. A roster larger than the confirmed quantity requires a billing administrator to review the subscription before adding members.
- Inspect missing-price/unbilled alerts in `/app/admin/billing`; reconcile catalog configuration and retry delivery without deleting the ledger.
- Resume pending membership revocation or conversion through the original operation; never clear pending intent to unblock access.
- Comp/Enterprise changes use `/app/admin/billing` or `bun run billing:operator`; cancellation/checkout failures must resolve before a comp can replace paid state.
- Keep spend-cap dates separate from subscription credit renewal, and recorded charges separate from final invoices.

## Verification and release

The [sandbox signing check](../evidence/polar-team-quotes-2026-11-24.md) covers local signed samples. The [USD catalog cutover evidence](../evidence/polar-usd-catalog-2026-11-24.md) covers unpaid quotes in both environments. Paid confirmation, invoice and tax verification, and delivery from a registered endpoint remain open.

Before enabling `BILLING_CHARGES_ENABLED`, retain dated evidence for the deployed revision, environment and customer mapping, registered webhook delivery, member portal isolation and revocation, cancellation and recovery, and a shadow-billing month reconciling invoice totals. Use synthetic authorized accounts.

Provider/legal readiness is tracked in [security gaps](../security-gaps.md). Account settings and invoices must be checked live before asserting they are correct; this guide is not deployment evidence.
