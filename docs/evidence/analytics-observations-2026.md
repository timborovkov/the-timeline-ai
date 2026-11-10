# Analytics observations, 2026

Historical observations only; the dates and verification boundaries below remain part of the evidence. Current procedure: [analytics setup](../setup/analytics.md).

The supplied 2026-11-07 account screenshot shows the managed proxy as Live for the EU project. No application proxy route or rewrite is needed. After deployment, verify an accepted public-page event reaches this host and appears in PostHog; rejection and private routes must still produce zero browser analytics requests. Proxy routing does not change consent, event payloads, retention, or the outstanding provider evidence gaps.

The 2026-10-24 production verification of an earlier implementation showed one visitor and four pageviews with recordings disabled. That implementation preceded this consent and pseudonymization contract; it does not verify the merged release. Keep the rollout gaps below open until the new boundary and provider configuration are verified in production. The existing [Launch dashboard](https://eu.posthog.com/project/245318/dashboard/917254) also predates the new contract; review its queries against the approved events and pseudonymous actors before using it for a new release readout.
