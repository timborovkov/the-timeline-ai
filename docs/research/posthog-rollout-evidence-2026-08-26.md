# PostHog rollout evidence

**As of:** 2026-08-26

**Status:** Internal evidence memo; provider configuration reviewed, production
release not verified

**Scope:** Timeline's PostHog Cloud EU project and the privacy-sensitive account
controls needed by the analytics implementation

This memo records account observations without copying project tokens, member
details, raw identifiers, IP addresses, device fingerprints, or screenshots into
the repository. It is operational evidence, not legal advice or a substitute for
the DPA, transfer, subprocessor, legal-basis, or production-canary reviews.

## Verified account state

- The project is hosted in PostHog Cloud EU.
- Client IP discard is enabled at project level.
- Web autocapture, automatic web-vitals capture, dead-click capture, session
  replay, heatmaps, and exception autocapture are disabled.
- The project contains no captured exceptions and no session recordings were
  found during this review.
- Project access is limited to the existing owner account. Advanced organization
  security and project access-control enforcement require a paid platform add-on
  and were not enabled.
- The organization remains on pay-as-you-go at the founder's direction. The
  observed bill was zero and product analytics remained inside the monthly free
  allowance. No hard product-analytics billing limit is currently saved.
- A dashboard named **Launch** was created and pinned. It is intentionally an
  empty shell until the approved production event schemas begin arriving.

## Retention and billing constraint

PostHog's current plan documentation states one-year product-event retention on
Free and seven-year retention on Pay-as-you-go. The project UI did not expose a
90-day product-event retention control. Because the account remains on
Pay-as-you-go, the implementation's 90-day target is not met by provider plan
retention. Production enablement therefore requires an explicit privacy/legal
decision or a separately evidenced deletion mechanism.

Pay-as-you-go has a zero base price and a monthly free allowance, but usage above
that allowance can be billed. The UI accepted a zero-dollar product-analytics
billing limit during a non-saving validation; the change was cancelled and no
billing setting was altered.

## Legacy PostHog data cleanup

The pre-rollout project contained 127 development/verification events across one
merged person record and one verification record. The legacy records included
raw application identifiers and provider-derived request, device, and
geolocation metadata. No customer-content values were observed or retained in
this memo.

Deletion was requested for both person records and all corresponding events and
recordings. PostHog states that associated events and recordings are removed on
a scheduled low-traffic deletion run, so this is **queued**, not verified
complete. Recheck the project before closing the deletion evidence gap.

## Still open

- Privacy/counsel approval for the legal basis and the unresolved retention
  decision.
- Current DPA, subprocessors, transfer safeguards, support-access terms, and
  provider deletion/backup behavior.
- A clean production environment with the EU host, project token, and an
  independent server-only analytics pseudonymization key.
- Browser network/storage canaries proving zero browser PostHog before consent,
  after rejection or withdrawal, and throughout private routes.
- Production payload canaries proving fixed-stream isolation, pseudonymous
  identities, exact allowlists, disabled GeoIP processing, and absence of raw
  identifiers or content.
- Population of the Launch dashboard after approved schemas arrive.
- Completion of the queued legacy-data deletion.
- Inventory and safe disposition of the separate legacy Convex deployment and
  any retained data.

## Primary provider references

- [PostHog pricing and plan retention](https://posthog.com/pricing)
- [PostHog data storage and person deletion](https://posthog.com/docs/privacy/data-storage)
- [PostHog Cloud regions](https://posthog.com/docs/privacy/regions)
