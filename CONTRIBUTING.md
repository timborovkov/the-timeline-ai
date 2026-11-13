# Contributing

Thank you for taking the time to improve The Timeline.

## Important repository status

The source is publicly inspectable, but this repository does not currently
publish a software license or general contribution terms. Public visibility is
not permission to copy, distribute, modify, deploy, or submit code. Opening an
issue also does not grant those rights.

Before substantial work or any pull request:

1. Open a non-sensitive
   [feature or improvement proposal](https://github.com/timborovkov/the-timeline-ai/issues/new?template=contribution_proposal.yml)
   describing the problem and proposed outcome.
2. Wait for a maintainer to confirm the scope and that a contribution can be
   accepted under agreed terms.
3. Keep the implementation within that agreed scope.

If the proposal cannot be discussed publicly, email
[contact@thetimeline.cc](mailto:contact@thetimeline.cc) instead.

## Reporting bugs safely

Use the structured
[bug report form](https://github.com/timborovkov/the-timeline-ai/issues/new?template=bug_report.yml)
for reproducible, non-sensitive defects. Use only your own or synthetic data.
Remove customer content, personal data, credentials, tokens, invite links,
signed URLs, private URLs, and identifiers.

Report vulnerabilities privately under [SECURITY.md](./SECURITY.md). Do not open
a public issue or pull request containing an unpatched vulnerability or working
exploit.

## Development expectations

- Use Bun 1.4.4 (see `.bun-version`) for installation, scripts, and tests.
- Read [AGENTS.md](./AGENTS.md) and the documentation relevant to the changed
  subsystem.
- Preserve team isolation, item visibility, secret handling, and the privacy
  and trust operating standard.
- Add focused tests for behavior changes and negative tests for permission or
  privacy boundaries.
- Update affected documentation and public claims in the same change.

## Branches

Use `<owner>/<type>/<description>`, with a short kebab-case description.
The owner is the responsible contributor's handle, regardless of which tool
writes the code. Examples: `<owner>/feat/calendar-sync` or
`<owner>/fix/invite-expiry`. Types: `feat`, `fix`, `docs`,
`refactor`, `test`, `chore`. Do not use `codex/`, `claude/`, or `cursor/`.
Automated dependency-update branches are exempt.

## Validation

Follow the [testing policy](docs/testing/README.md#validation-policy).
Run focused local tests for changed behavior; GitHub runs repo-wide checks.
Required checks gate merging, not committing, pushing, or opening a PR.

## Pull requests

Titles must use `<type>: <clear outcome>`, using the same types as branches.
Keep them short and specific, for example `docs: simplify contributor guidance`
or `fix: prevent duplicate invitations`. Do not include agent names or work diaries.

Keep each PR focused. Default to a short problem/change summary and the checks
run with their results. Add rollout, migration, security, or compatibility details
only when relevant. Link the agreed issue for external contributions.
Do not repeat the diff, narrate the agent's work, or paste logs and standing policy.
Use the [PR template](.github/pull_request_template.md).

Never include production data, customer content, credentials, tokens, private
logs, or screenshots containing sensitive information.

## Review

Before marking a PR ready, obtain a Codex review of the proposed changes:

1. Review the current diff against the PR's target branch.
2. Address actionable findings. Explain any disagreement with evidence.
3. Rerun checks affected by the fixes, then request another Codex review.
4. Repeat until no actionable findings remain. Record the reviewed commit and
   a review link or local review result in the PR.

New commits require another review. Unavailable or incomplete review is a blocker,
not a pass. Codex review does not replace the maintainer's merge decision.

This is currently a contributor requirement, not an automated merge gate. GitHub
needs a required check that verifies review completion for the current PR head;
a checklist tick or review of an older commit is insufficient.
