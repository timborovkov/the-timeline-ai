---
name: diff-review
description: >-
  Performs a read-only, high-signal review of changes in the current Git branch
  or worktree, defaulting to the effective working tree versus the merge base
  with the repository's main/master/default branch. Finds introduced bugs,
  regressions, security and data risks, incomplete requirements, and meaningful
  test gaps; verifies candidates, ranks them P0-P3, and reports confidence
  scores with exact file/line evidence. Use for "review my changes," "review
  this diff/branch/worktree," "pre-merge review," "check this PR," "find bugs
  in my changes," or a Codex/Claude-style code review. Skip implementation or
  review-comment resolution unless the user separately asks to fix findings.
---

## Timeline repository contract

Read root `AGENTS.md` and path-scoped instructions first. Their Bun-only commands,
validation gates, operational exemptions, privacy rules, and authorization scope
override generic examples below. Load this skill by reading its file if the client
has no Skill tool. Never assume local-machine tools, credentials, or global skills
exist in a cloud checkout.


# Diff Review

Review the change, not the author. Optimize for defects the author would act on.

## Operating contract

- Stay read-only: do not edit, stage, revert, commit, push, or post remote
  comments. A successful review produces findings, not fixes.
- Treat fetches and diagnostics as evidence gathering. Do not install
  dependencies or run commands that require secrets or mutate external systems.
- Follow root and path-scoped `AGENTS.md`, `CLAUDE.md`, `REVIEW.md`,
  `CONTRIBUTING.md`, and equivalent repo guidance.
- Review only problems introduced, exposed, or materially worsened by the
  selected change. Suppress unrelated pre-existing defects unless they make the
  changed behavior unsafe; label that relationship explicitly.
- Prefer silence over a speculative finding. Never invent a bug to make the
  review look useful.

## 1. Resolve scope

Honor an explicit base, commit, file set, staged-only, uncommitted-only, or PR
scope from the user. Otherwise run:

```bash
<skill-dir>/scripts/review-scope.sh
```

The default scope is the merge base of the detected default branch and `HEAD`
through the current working tree. It includes committed branch changes plus
staged and unstaged tracked changes; inspect every untracked path listed by the
helper separately. This works on a normal checkout, linked worktree, detached
HEAD, or the default branch with local changes.

If refreshing the remote base is undesirable or unavailable, rerun with
`--no-fetch`. Pass `--base <ref>` when the user names a base. State the exact
base ref, merge-base SHA, dirty-state coverage, and any fetch fallback in the
report.

Stop with a concise explanation when there is no diff. Do not treat being on
the base branch as sufficient reason to stop if the worktree is dirty.

For the default scope, use the emitted merge-base SHA consistently:

```bash
git diff --no-ext-diff --find-renames <merge-base>
git diff --name-status --find-renames <merge-base>
git log --oneline <merge-base>..HEAD
git diff --check <merge-base>
```

## 2. Build context

Before judging individual lines:

1. Read the applicable repo instructions.
2. Read the complete diff, name-status, diffstat, commit list, and untracked
   files. Notice renames, deletions, generated files, lockfiles, migrations,
   config, fixtures, and binary changes.
3. Infer intent from the user's request, branch commits, local plan/TODO files,
   tests, and PR metadata when safely available. Do not assume commit messages
   are a complete specification.
4. Summarize the implementation in one or two private sentences, then compare
   the diff with the apparent intent. Flag scope drift or missing requirements
   only when there is concrete evidence.
5. Read enough unchanged surrounding code, callers, schemas, tests, and history
   to understand changed behavior. A diff is the scope boundary, not the
   context boundary.

For a large diff, review by subsystem or behavior slice while still reading the
whole diff. Do not silently sample files.

## 3. Find and verify candidates

Read [references/review-rubric.md](references/review-rubric.md) before producing
findings. Apply every relevant review dimension, then make one adversarial pass
for production failure modes.

When parallel subagents are available and the diff is large, cross-cutting, or
touches auth, security, money, persistence, migrations, concurrency, or release
infrastructure, dispatch up to three independent read-only discovery passes:

- behavior and invariant violations
- security, data, concurrency, and operational failure modes
- contracts, completeness, compatibility, and meaningful test gaps

Give each pass the raw scope and repo instructions, not suspected findings or
an expected answer. For a very large diff, divide by coherent behavior slice
and add one cross-cutting pass for interactions. The primary reviewer must still
read the full diff, independently verify every returned candidate, deduplicate
root causes, and own the final scores. Review locally when subagents are absent
or the change is small.

For every candidate:

1. Identify the changed line or hunk that introduces the behavior.
2. Trace the concrete failing path through definitions, callers, data shape,
   configuration, or tests.
3. Check whether another part of the same diff already handles it.
4. Distinguish a demonstrable defect from a preference, possible improvement,
   or CI-enforced issue.
5. Run the smallest safe diagnostic or targeted test only when it materially
   raises confidence. Do not run a broad suite merely to make the review look
   thorough.
6. Re-read the evidence from a skeptical perspective. Downgrade or suppress the
   candidate when a required assumption remains unverified.

Deduplicate by root cause. One defect affecting several callers is one finding
with the clearest primary location and affected paths noted in the body.

## 4. Report findings first

Order findings by severity, then confidence. Use this shape:

```markdown
## Findings

1. [P1 | confidence 94/100] Short imperative title
   `path/to/file.ts:42`
   Explain the failing scenario and user/production impact. Cite the specific
   changed behavior and the evidence that verifies it. End with the smallest
   safe correction direction and a focused verification idea.

## Review summary

- Verdict: Block / Needs changes / Non-blocking / No findings
- Scope: `<base-ref>` at merge base `<short-sha>` through current worktree
- Reviewed: N paths; committed + staged + unstaged + N untracked
- Findings: P0 N, P1 N, P2 N, P3 N
- Verification: commands run, or "static review only"
- Residual risk: material areas not verified, or "none identified"
```

Keep each finding self-contained and actionable. Use the line that best exposes
the defect; prefer a changed line. If the host supports local, non-posting inline
annotations, mirror main findings there, but keep the final report complete on
its own. Never post remote review comments without a separate user request.

If no reportable findings remain, say so directly. Do not claim the change is
correct; state what was reviewed and any material residual risk. Do not include
an empty findings heading, compliments, a diff walkthrough, or low-value nits.

## Verdict mapping

- **Block:** any P0, or a P1 involving security, data loss/corruption, auth,
  irreversible migration, or a guaranteed core-path failure.
- **Needs changes:** any other P1, or multiple P2 findings that jointly make the
  change unsafe to merge.
- **Non-blocking:** only P2/P3 findings.
- **No findings:** no candidate meets the reporting threshold.

Do not convert confidence into severity. Severity measures impact; confidence
measures certainty.
