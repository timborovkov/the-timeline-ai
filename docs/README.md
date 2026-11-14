# Developer documentation

Read the document for the task at hand. Current behavior, future work and historical evidence have separate owners. [The repository README](../README.md) is the product/code entry point; [AGENTS](../AGENTS.md) owns contributor rules.

## Start and operate

- [Local development](setup/local.md), [demo corpus](demo-corpus.md), [testing](testing/README.md).
- [Railway deployment](railway.md), [operations and maintenance](operations.md).
- [Integration setup](setup/integrations.md), [OpenRouter](setup/openrouter.md), [Polar billing](setup/polar.md), [Resend](setup/resend.md).
- [Telegram](setup/telegram.md), [Slack conversations](setup/slack.md), [meeting bots](setup/meeting-bots.md), [analytics](setup/analytics.md), [Sentry](setup/sentry.md).
- [Platform administration](platform-admin.md), [support deletion](setup/manual-support-deletion.md), [conversation diagnostics](conversation-diagnostics.md).

## Understand and change behavior

- [Product brief](product-brief.md), [glossary](../CONTEXT.md), [open work](../todo.md).
- [Memory engine](relational-memory.md), [domain ownership](architecture/ownership.md), [Drive lifecycle](architecture/drive.md), [billing contract](architecture/billing.md).
- [Website sources](websites.md).
- [Objects and boards](objects.md), [calendar](calendar.md), [captured files](captured-files.md), [agent coworkers](agent-coworkers.md).
- [Design foundations](../design.md), [application patterns](design/app.md), [public-site patterns](design/public.md).
- [Provider contribution template](native-provider-template.md), [public document registry](public-site-registry.md), [analytics contract](privacy-analytics-interface.md).
- [Architecture decisions](adr/README.md): rationale, not a second live specification.

## Rollout and evidence

- [Evidence-pack promotion](relational-memory.md#cross-source-evidence-rollout), [marketplace publication](marketplace-submissions.md), [Google OAuth verification](research/google-oauth-readiness.md).
- [Security/privacy requirements](security-privacy-trust.md), [provider register](providers.md), [open security gaps](security-gaps.md).
- [Dated evidence](evidence/README.md); old observations do not certify current deployment/account state.
- [WhatsApp proposal](whatsapp-groups-implementation-plan.md): conditional, not implemented product behavior.
- [Transcription evaluation](testing/transcription-quality-eval.md), [runtime benchmark methodology](../scripts/performance/README.md).

## Documentation maintenance

Each fact has one owner: policy in the security standard, provider facts in the register, unresolved controls in the gap register, procedures in runbooks, product tasks in `todo.md`, decisions in ADRs, and external observations in dated evidence. Link to the owner; do not maintain copied checklists or status tables.

Remove completed roadmap items in the completing change. Ordinary implementation/test/merge history stays in Git, PRs and CI. Preserve historical material only when it contains unique decision or external evidence; label its date and scope.

Use Markdown for internal authoring. Product email templates, public app content and the distributed Timeline skill are runtime artifacts with their own validation. Bundled third-party skills retain attribution and package structure; update them deliberately from their provenance rather than hand-merging reference files.

A normal change reviews affected owners and inbound links. A requested full audit reviews the entire set. Keep the public path/anchor map in sync when moving documents; do not change historical SQL migrations to fix a prose link.
