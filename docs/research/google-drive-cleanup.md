# Google Drive ownership cleanup

Baseline: `9b9d80fd`, after integrating Drive v1 (`94266d8d`) into
`feature/codebase-cleanup`.

Goal: a Drive lifecycle or policy change has one clear owner, and callers cannot
silently omit required behavior. Scope is structure and redundant comments;
existing regression tests remain in place.

## Decisions

1. Give transient extraction an explicit lifecycle and a small wire protocol.
   Sync, janitor, selection cleanup, and disconnect previously coordinated
   deletion, tombstones, and cursor persistence separately. The shared cleanup
   operation owns that ordering; worker lifecycle operations own publication,
   reads, consumption, and sweeps. The credential-thin producer consumes only the
   wire protocol and remains separate from workspace persistence.
2. Require Drive capture services at the provider boundary.
   Generic sync context previously advertised optional Drive methods, allowing
   missing persistence to become a no-op and missing history to look like a new
   baseline. Drive now receives one complete service assembly. Snapshot and
   ancestry contracts have canonical owners, with legacy nullable values kept
   distinct from normalized evidence decisions.
3. Give selection link changes a transaction-aware owner.
   Object merging and integration settings previously repeated selection writes,
   sibling loading, and artifact rebinding. Selection-link operations now share
   that protocol inside the caller's transaction. Drive artifact reconciliation
   is separate from generic artifact storage; pure inheritance policy and
   metadata codecs are separate from capture persistence.
4. Name scheduling intents instead of relying on callers to coordinate strings.
   File captures, extract resumes, and feed continuations use a shared scheduling
   contract. Existing persisted job shapes, deduplication IDs, pause retention,
   and durable handoff acknowledgement remain compatible.
5. Bind OAuth registration metadata to its authentication attempt.
   A process-global email-keyed map previously connected the sign-in callback to
   account creation. Each Auth.js configuration invocation now owns a single-use
   registration context. Missing current-attempt metadata cannot establish email
   verification.
6. Separate browsing from selection validation.
   Personal connections previously fabricated full integration rows, and UI
   listing doubled as authorization. Resource access uses a small identity;
   browsing and validation have separate methods. Drive validates explicit IDs,
   while flat catalogs validate against their full resource list. Owner sharing
   and team activation keep their distinct authorization boundaries.

## Preserved requirements

- Persist the extract cursor before publishing its job; retain cancellation
  tombstones through the producer wait, even after a missing-object response.
- Fail closed on disconnect while an extract producer can still write. Retry
  cleanup without discarding evidence of remaining work.
- Keep paid extraction and processing budgets, revision checks, and delayed
  retries. A file-only capture must not mark the shared changes feed recovered.
- Advance snapshot fields only when their required evidence was stored; preserve
  grant-delta semantics, comment fragments, and unknown ancestry.
- Keep explicit file links and most-specific ancestor precedence. Link changes
  stay transactional and must not rewrite immutable raw event content.
- Keep legal-publication checks, verified Google claims, account-linking rules,
  invite provisioning, limited sign-in scopes, and shared-grant revoke policy.

## Verification

Focused regressions passed for Drive provider capture (77), snapshot revisit,
transient cleanup (4), sync (86), extraction (45), janitor (21), capture storage
and disconnect (62), artifact linking (37), event writing (45), scope policy (16),
and objects (93). OAuth isolation, auth actions, resource authorization, all
non-Drive provider suites, and the 53 queue registrations also passed. Existing
tests were retained; new cases cover missing required services, overlapping OAuth
attempts, late-producer cleanup, resource validation, and explicit metadata patches.

`bun run validate` passed formatting, types, ESLint, and Knip. Knip retains two
non-blocking pre-existing worker-entry configuration hints. `bun run doctor`
reported **React Doctor score: 100 (Great)** and **No issues found!** Both
`bun run test:eval` and `bun run test:reconciliation-eval` passed.
`bun run test:dist-imports` passed, including the new Drive protocol, lifecycle,
scheduling, and required-context subpaths.

Independent reviews checked required capture services, resource authorization,
transactional linking, and transient cleanup. No actionable introduced defects
remained. The documentation review covered the provider template, extraction ADR,
OAuth evidence notes, branch decision log, and repository layout; relative links
and diff whitespace were checked.

Commands used Bun 1.4.4; installed build/analysis shims retain the repository's
recorded analyzer exception. These are local checks, not a live Google-provider
verification, merge, or deployment claim.
