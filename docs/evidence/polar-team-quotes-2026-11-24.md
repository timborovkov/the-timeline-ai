# Polar Team quote and signing evidence, 24 November 2026

The sandbox run exercised the `c434b19d` checkout adapter with the same multi-currency product validation included in the combined revision. A disposable private Team product carried USD prices and the sandbox organization's required default EUR prices. Polar created both unpaid quotes in USD with fixed quantities.

| Full seats | Pre-tax quote | Checkout status | Retry |
| --- | --- | --- | --- |
| 1 | $10 USD | Open | Recovered the original quote |
| 3 | $30 USD | Open | Recovered the original quote |

The fixture product was archived and both fixture customers were deleted. The existing active catalog and webhook endpoints were verified unchanged.

Polar CLI `subscription.active` and `order.paid` samples were posted to a disposable loopback receiver. Both signed requests reached the receiver's `invalid_external_customer` result with HTTP 200. Altering each signed body yielded HTTP 401 `invalid_signature`. The samples used no mapped workspace and caused no entitlement changes.

Paid confirmation, real invoices and applicable tax calculations, and delivery from a registered sandbox webhook endpoint remain unverified. See [Polar release checks](../setup/polar.md#verification-and-release).
