# Repository coding skills

These 22 complete skill folders travel with the repository into Codex Cloud and
other repository-aware agents. They are regular files, not links into a developer's
home directory. Use root `AGENTS.md` as the operating contract. This collection is
for developing Timeline; `plugins/timeline` is the separate product/MCP consumer plugin.

## Included workflows

Use the narrowest applicable entry point. `interface-review` reviews an explicitly selected diff, branch or PR; `better-interface` is a broader audit that routes to focused domain references. Root AGENTS owns repository validation; skill examples do not create additional local gates.

| Group | Skills |
| --- | --- |
| Delivery | `ship`, `diff-review`, `document-release`, `handoff`, `upstream-sync` |
| Engineering | `test-strategy`, `untangle-codebase`, `deslop`, `diagnosing-bugs` |
| React and docs | `react-doctor`, `vercel-react-best-practices`, `vercel-composition-patterns`, `find-docs` |
| UI review | `interface-review`, `better-interface`, `better-accessibility`, `better-layout`, `better-writing`, `better-typography`, `better-colors`, `better-ui` |
| Operations | `use-railway` |

Skill names are generic; no legacy aliases or global skill installation is needed.
`ship`, `handoff`, and `interface-review` are explicitly invoked. Use the client's
invocation mechanism or read `.agents/skills/<name>/SKILL.md` directly. A listed
skill is instruction content, not proof that its tools or credentials are available.
If a workflow requests subagents but the client has no delegation support, perform
the relevant passes serially and report that limitation; do not invent agent results.

## Cloud environment

Install the Bun version from `.bun-version`, then run `bun run deps --frozen-lockfile`
in the cloud environment setup. This installs the project-local React Doctor and
Playwright dependencies; do not rely on the Mac's global executables. For browser
work, provision the browser and OS dependencies required by the existing Playwright
configuration. Database, Redis, Qdrant, object-storage, and live-model prerequisites
still follow the local setup and E2E isolation guides; never use production services
for test fixture setup or cleanup.

Run root `bun run doctor` for the required React Doctor gate. A generic scanner
exit code, missing score, or unavailable scoring endpoint does not prove a score
of 100. Keep applicable `bun run validate`, targeted tests, and live-eval requirements
from `AGENTS.md`. Prose-only agent instructions retain its validation exemption.

External documentation, canonical diagnostic playbooks, and scoring may need
network access. Report blocked retrieval or verification accurately. Cloud tasks
without authenticated Git/PR tooling should return their patch and publication
status to the host; Railway needs separately authorized, authenticated access.
Do not provision credentials or deploy merely because skills were installed.

Read these repository files from the checked-out revision; environment credentials and tooling are configured separately.

## Provenance and maintenance

`sources.json` records each installed source entrypoint's SHA-256, upstream location,
and the personal collection revision where available. These are snapshots of the
locally installed folders, not claims that all upstream repositories are at their
latest revision. Supporting references and helpers are included. Keep their notices
and licenses when updating. The bundle's license files apply only to their relevant
third-party content; they do not license the Timeline application.

Personal skills were renamed and cross-references adapted. Timeline-specific
changes establish repository precedence, Bun commands, the canonical doctor gate,
cloud completion boundaries, and explicit Railway deployment scope. Deslop uses
ordinary repository search instead of requiring another global skill. The Vercel
skills declare MIT licensing in their original frontmatter; their upstream repository
provided no separate license file in the inspected tree. Retain the author metadata.

Update a selected skill deliberately from its recorded source, copy the full folder,
preserve notices, reapply the Timeline adaptations, and preserve its source hash. Record `localSha256` for a locally adapted entrypoint so local edits do not masquerade as an upstream snapshot.
Check local Markdown links, frontmatter/name consistency, invocation policy,
package-manager commands, referenced skills, and absence of external symlinks.
Review helper scripts before running them. Do not regenerate this bundle from all
globally installed skills: unrelated marketing, scaffolding, Cloudflare, and React
Doctor rule-development workflows are intentionally excluded.
