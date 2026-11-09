---
name: ship
description: Finish and ship the current change in the user's style. Invoke explicitly for scoped cleanup, review, validation, documentation, commit/push, PR creation, and CI or review follow-through; also supports explicitly requested individual stages.
disable-model-invocation: true
---

## Timeline repository contract

Read root `AGENTS.md` and path-scoped instructions first. Their Bun-only commands,
validation gates, operational exemptions, privacy rules, and authorization scope
override generic examples below. Load this skill by reading its file if the client
has no Skill tool. Never assume local-machine tools, credentials, or global skills
exist in a cloud checkout.


# Ship

Run when explicitly requested. A full shipping request authorizes the normal commit,
push, PR, and review-response workflow; respect any narrower endpoint the user gives.
Do not merge, publish packages, or deploy unless requested. Do not ask again for
steps already authorized. A cleanup-only or review-only request does not authorize shipping.

## Establish scope

Read repository instructions, contribution guidance, package scripts, and CI.
Inspect the worktree and branch; preserve unrelated user work. Review the effective
change, including committed branch changes, staged/unstaged edits, and relevant
untracked files against the default branch's merge base. Exclude generated,
vendor, build, lockfile, and agent-state content from cleanup.

Use repository commands and conventions rather than assuming Bun, `nr`, a
particular branch name, or React Doctor's own development workflow.

## Clean up and review

Apply behavior-preserving cleanup within the change: dead private code, redundant
comments, duplication, unnecessary indirection, and needlessly complex logic.
Optimize clarity, not line count. No mandatory findings file or per-finding approval
for work already within scope.

- Use `deslop` when available for scoped cleanup. Its generic conventions are
  subordinate to this workflow and the repository: do not impose return-type,
  file-layout, exception-handling, or helper-inlining rules without a local reason.
  Use its duplicate-search tool when available and useful; ordinary code search
  is sufficient otherwise. Similar names do not prove equivalent behavior.
- Use `untangle-codebase` only for explicitly requested structural work or a
  demonstrated structural blocker. Do not run a whole-repository refactor during
  routine shipping. Report broader improvements separately.
- Preserve public exports, signatures, externally consumed data shapes, and APIs
  unless changing them is part of the authorized task. No in-repo callers is not
  proof that a public API is unused. Update all consumers for private renames.
- Verify meaningful behavior coverage before risky refactors; add focused tests
  when needed. Avoid tests that merely mirror implementation or tautological mocks.
- Use `diff-review` for a final review when available; fix verified introduced
  defects, then rerun checks affected by those fixes.
- Use `react-doctor` for React/Next changes. Use the project-local dependency through `bun run doctor`
  where the root instructions require it. Do not import its repository-specific release commands.

Specialist skills provide techniques; this workflow owns scope and shipping policy.
If a specialist is unavailable, perform its relevant work directly and report any
material verification limitation rather than pretending it ran.

## Verify and document

Run required project gates. Prefer `bun run validate` when the repository defines
it; otherwise use the documented formatting, lint, typecheck, test, and build checks
appropriate to the change. Use `test-strategy` for substantial testing work.
Follow root `AGENTS.md` for failed gates, including its requirement to fix repo-health failures.
Stop shipping if a required gate remains unresolved; never waive the repository gates yourself. Avoid expanding verification without cause.

Update affected docs and TODO/status files from evidence. Run `document-release` before handoff as required by root `AGENTS.md`. Preserve docs formats.
Inspect the final diff and `git diff --check` for unrelated files, secrets, stale
comments, and unmet project requirements such as localization.

## Commit, push, and open the PR

Stage only intended files, commit using the repository's style, and push the feature
branch. Never force-push a shared default branch; use `--force-with-lease` only for
an authorized history rewrite. Do not bypass hooks. Use `upstream-sync` when
integration is needed, preserving both sides' intent.

Create or update the PR with the concrete problem, resulting behavior, and relevant
validation. Use the repository template and `pr` skill when available. With `gh`,
pass multiline text through `--body-file`. Do not assume `/rule-validate`, `/review`,
or `/babysit` commands exist.

## Follow through

Monitor checks for the latest pushed commit. Investigate failing logs, fix in-scope
causes, rerun relevant checks, and push. Triage review/Bugbot comments: fix, already
handled, not applicable, or disagree with concise evidence. Reply and resolve only
within the authorized shipping/review workflow and only when actually handled.

Continue until required checks are green and actionable reviews are handled, or a
concrete blocker needs user input. Report infrastructure failures, unavailable
checks, conflicting requirements, or external approval dependencies rather than
looping indefinitely. Honor requests to stop at an earlier stage. Do not merge.

Report what changed, validation, commit/PR links, and outstanding checks or blockers.
Handoff is a separate explicit command, not a mandatory shipping stage.

## Cloud completion

Use `bun run validate`, `bun run doctor`, and the targeted tests required by
`AGENTS.md` for applicable changes. Prose-only instructions retain the operational
exemption. Run `document-release` for the final documentation pass.
A cloud task may return a patch for the host to turn into a PR. If authenticated
Git/PR tools are unavailable, finish the patch, report verification and remaining
publication steps, and stop; do not invent a push or PR URL or demand credentials.
Use `handoff` only when a saved continuation is requested. Optional `pr` or
`in-repo-docs` skills are not bundled: use the repository PR template and existing
documentation conventions directly.
