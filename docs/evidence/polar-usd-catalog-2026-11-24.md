# Polar USD catalog cutover, 24 November 2026

The rollout operator verified the sandbox and live organizations after updating their default presentment currency and catalog. Polar required every active product to support USD before switching the default. The operator archived the old Timeline and unrelated Irmin or Vernix offers with approval. Subscription status counts and webhook configuration matched the pre-cutover snapshots.

| Environment | Team product | Enterprise product | Unpaid Team quotes |
| --- | --- | --- | --- |
| Sandbox | `7ab0d661-a9a7-4808-bed9-eb2377edd91e` | `2e3d49d8-e53a-4c23-80bc-6566a723cb69` | 1 seat for $10, 3 seats for $30 |
| Live | `ccc572bc-7aa7-466a-afe8-fbc1378a6f00` | `e965951a-542e-4ac5-b6dc-006e7e8ae20b` | 1 seat for $10, 3 seats for $30 |

Readback showed monthly USD pricing with $10 per Team seat, a custom Enterprise fee, and two prices on the reused organization-local meters. AI costs one cent per metered unit and native meeting capture costs three cents per minute. Prices use exclusive tax behavior. Polar accepted the custom Enterprise price with its maximum omitted and rejected a maximum of 100,000,000 minor units because the allowed maximum is 99,999,999.

The operator checked the visible provider catalog and created unpaid quotes. Paid confirmation, collected tax, invoices, seat proration, and delivery from a registered webhook endpoint remain unverified. See the [release checks](../setup/polar.md#verification-and-release).
