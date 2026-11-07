# Diff Review Rubric

Use this rubric to produce a small number of verified findings. The default
review is defect-focused, not a general code-quality critique.

## Contents

1. Review dimensions
2. Candidate verification
3. Severity
4. Confidence
5. Reporting and suppression

## 1. Review dimensions

Apply each dimension only where the diff makes it relevant.

### Intent and completeness

- Does the implementation satisfy the stated behavior end to end?
- Are error, empty, retry, cancellation, permission, and partial-success paths
  complete?
- Did the change omit a required caller, route, enum case, serializer,
  migration, config value, feature flag, locale, platform, or deployment step?
- Did unrelated refactoring widen the blast radius or make rollback harder?

Missing behavior is a finding only when intent is evidenced by the user request,
tests, public contract, issue/PR text, repo docs, or a strong invariant. Do not
turn guesses about product requirements into defects.

### Correctness and edge cases

- Check boundary values, state transitions, ordering, duplicates, nullability,
  parsing, coercion, time zones, units, precision, and off-by-one behavior.
- Trace both success and failure paths, including cleanup and retry behavior.
- Check changed assumptions against actual callers and data producers.
- When a new variant or enum value appears, search all consumers of sibling
  values for missing handling outside the diff.

### Security and privacy

- Check authentication versus authorization, tenant/user scoping, trust
  boundaries, injection, path traversal, unsafe deserialization, SSRF, XSS,
  CSRF, secret or PII exposure, permission defaults, and cryptographic misuse.
- Treat model, tool, webhook, file, network, and user-controlled output as
  untrusted at the next boundary.
- Verify exploit prerequisites and mitigations in surrounding code before
  reporting.

### Data integrity and migrations

- Check transaction boundaries, idempotency, uniqueness, destructive updates,
  partial writes, retries, schema/code rollout order, backward compatibility,
  backfills, defaults, and rollback safety.
- Inspect both forward and backward compatibility when old and new application
  versions may run together.
- Flag data-loss or corruption paths even when rare if the trigger is plausible.

### Concurrency, async, and lifecycle

- Check races, stale reads, double execution, locking, atomicity, cancellation,
  resource ownership, subscription/listener cleanup, and shutdown behavior.
- Confirm async work is awaited or intentionally detached and that errors do not
  disappear silently.
- Verify UI effects, background jobs, caches, and retries under repeated or
  out-of-order execution.

### API and compatibility

- Check request/response shapes, public exports, CLI flags, config/env names,
  persistence formats, events, and error semantics.
- Look for callers or consumers that still use the previous contract.
- Treat framework or library claims as version-specific. Consult current docs
  only when a finding or fix direction depends on an external API.

### Performance and resources

- Report only meaningful regressions: unbounded work, N+1 I/O, hot-path
  complexity, memory/file/socket leaks, missing pagination, excessive payloads,
  or blocking work in latency-sensitive paths.
- Establish a plausible workload or code path. Avoid micro-optimization advice.

### Errors, observability, and operations

- Check swallowed errors, misleading success, unsafe fallback behavior,
  non-actionable errors, broken health checks, retry storms, and logs/metrics
  that leak data or hide failures.
- Check config, build, release, migration, and rollback implications when the
  changed behavior crosses an operational boundary.

### Tests and documentation

- Determine whether tests exercise the changed contract and the failure mode
  most likely to regress.
- Do not report "missing tests" by itself unless repo guidance requires them or
  the gap leaves important changed behavior unprotected. Prefer describing the
  concrete untested regression.
- Flag stale docs, examples, or TODO state only when the diff changes a user,
  developer, or operational contract they describe.

## 2. Candidate verification

A reportable finding needs all of:

- **Introduced relationship:** identify how the selected diff introduces,
  exposes, or materially worsens the problem.
- **Trigger:** name realistic input, state, ordering, or environment conditions.
- **Impact:** explain observable wrong behavior, security exposure, data risk,
  outage, compatibility break, or operational failure.
- **Evidence:** cite exact file/line evidence and inspect the definitions,
  callers, tests, schemas, or history needed to validate the claim.
- **Action:** give a bounded correction direction. Do not prescribe a large
  redesign when a smaller invariant-preserving fix exists.

Prefer proof in this order:

1. Focused reproduction or existing failing test.
2. Direct code-path proof using concrete values and invariants.
3. Strong pattern match verified against surrounding implementation.
4. Suspicion requiring an unverified assumption.

Only the first three belong in the main report. Multiple reviewers noticing the
same candidate can increase attention, but agreement is not a substitute for
verification.

## 3. Severity

- **P0 — Critical:** broadly exploitable security failure, irreversible or
  widespread data loss/corruption, severe outage, or a release-blocking failure
  with no reasonable workaround. Stop-the-line.
- **P1 — High:** a concrete bug that can break core behavior, violate auth/data
  boundaries, make a migration unsafe, or cause a serious regression under
  realistic conditions. Fix before merge.
- **P2 — Medium:** a real, localized defect under plausible conditions with
  bounded impact or a practical workaround. Fix soon; may be non-blocking based
  on release context.
- **P3 — Low:** a minor but objective defect in changed behavior or required
  documentation. Never use P3 for taste, naming preference, optional cleanup,
  or generic maintainability advice.

When impact depends on unknown deployment or product context, state the
assumption and lower severity unless the user provides evidence.

## 4. Confidence

Score certainty independently of impact:

- **95-100:** reproduced by a focused command/test, or proven by an unavoidable
  code path with all relevant definitions inspected.
- **85-94:** verified from concrete code, callers, and invariants; trigger is
  realistic but not executed.
- **80-84:** strong evidence after contextual inspection, with one minor stated
  uncertainty that does not undermine the defect.
- **60-79:** plausible but a material assumption remains. Suppress from the main
  report; mention under residual risk only if it would guide useful verification.
- **0-59:** weak pattern match or speculation. Suppress entirely.

Default reporting threshold: confidence 80. A potential P0 below 80 may appear
only as an explicitly unverified stop-and-check item, never as a confirmed P0.
Do not use fake precision: choose a score that reflects the band and state the
remaining uncertainty.

## 5. Reporting and suppression

Report findings only when the author can act on them. Suppress:

- pre-existing issues unrelated to the selected diff
- personal style preferences and optional refactors
- formatting, lint, or type errors that an established required gate will
  already report, unless the gate is absent/broken or the failure has broader
  behavioral meaning
- generic advice such as "add error handling" or "add tests" without a concrete
  failure scenario
- generated output reviewed as if it were handwritten source
- duplicate symptoms of one root cause
- claims already addressed elsewhere in the same diff
- issues whose trigger contradicts a documented invariant

Review generated files and lockfiles at the contract level: verify their source
change, manifest consistency, unexpected dependency movement, and deployment
impact. Do not line-review mechanical payloads unless they are themselves the
source of truth.

Anchor a finding to the smallest useful changed range. If the proof lives in
unchanged code, cite both the changed trigger and unchanged supporting evidence.
Keep quoted code minimal; a file/line reference plus explanation is usually
clearer.
