# Contributing

Thank you for taking the time to improve The Timeline.

## Important repository status

The source is publicly inspectable, but this repository does not currently
publish a software license or general contribution terms. Public visibility is
not permission to copy, distribute, modify, deploy, or submit code. Opening an
issue also does not grant those rights.

Before substantial work or any pull request:

1. Open a non-sensitive
   [contribution proposal](https://github.com/timborovkov/the-timeline-ai/issues/new?template=contribution_proposal.yml)
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

- Use Node.js 24+, pnpm 11.8+, and `pnpm` only.
- Read [AGENTS.md](./AGENTS.md) and the documentation relevant to the changed
  subsystem.
- Preserve team isolation, item visibility, secret handling, and the privacy
  and trust operating standard.
- Add focused tests for behavior changes and negative tests for permission or
  privacy boundaries.
- Update affected documentation and public claims in the same change.

Before handing a change back, run:

```bash
pnpm validate
pnpm run doctor
```

React Doctor must report a score of 100. Also run the nearest focused tests and
any broader suites required by [AGENTS.md](./AGENTS.md).

## Pull requests

Keep a pull request focused and explain:

- the problem and agreed issue;
- the behavior and data-flow changes;
- the tests and exact commands run; and
- any rollout, migration, privacy, security, or compatibility concerns.

Do not include production data, customer content, credentials, tokens, private
logs, or screenshots containing sensitive information.
