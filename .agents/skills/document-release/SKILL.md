---
name: document-release
description: >-
  Refreshes every maintained documentation surface for a release or completed
  body of work, including Markdown, MDX, static HTML, generated docs, READMEs,
  changelogs, guides, and docs navigation. Use when the user says "document
  release," "release the docs," "refresh all docs," "bring docs up to date,"
  or asks for a repository-wide documentation sync before shipping. Skip
  single-document authoring and ordinary code changes that need only a small
  local docs edit.
---

## Timeline repository contract

Read root `AGENTS.md` and path-scoped instructions first. Their Bun-only commands,
validation gates, operational exemptions, privacy rules, and authorization scope
override generic examples below. Load this skill by reading its file if the client
has no Skill tool. Never assume local-machine tools, credentials, or global skills
exist in a cloud checkout.


# Document Release

Refresh the whole documentation set from repository truth. Verify every
maintained doc, but edit only what is stale.

## 1. Establish the release truth

- Read `AGENTS.md` and/or `CLAUDE.md`, `CONTRIBUTING.md`, docs guidance,
  manifests, relevant CI workflows, and release scripts.
- Inspect `git status`, the current branch, and the release diff or range named
  by the user. If none is named, compare the working state with the merge base
  of the default branch and use the checked-out repository as product truth.
- Derive claims from code, tests, configuration, migrations, and shipped
  behavior. Do not treat plans, branch names, or old docs as proof.
- Preserve unrelated user changes and report any release boundary that remains
  uncertain.

## 2. Inventory every maintained surface

- Enumerate tracked docs and docs sources. Include Markdown/MDX, HTML, reStructuredText,
  AsciiDoc, READMEs, changelogs, guides, examples, API/schema references,
  versioned docs, navigation/index files, and user-facing help content.
- Inspect build scripts and docs configuration to find source-to-output
  relationships.
- Classify each surface as source-authored, generated, mirrored/localized, or
  published output.
- Exclude dependencies, vendored material, caches, and untracked build output
  unless the repository explicitly maintains them.
- Treat "refresh all docs" as review-all, not rewrite-all.

## 3. Refresh coherently

- Correct stale behavior, terminology, versions, paths, commands, flags,
  configuration, examples, links, and compatibility claims.
- Update release notes or changelogs only from evidence in the release scope.
  Call out breaking changes, migrations, and operational steps when relevant.
- Keep READMEs, guides, API references, indexes, sidebars, and cross-links
  consistent with one another.
- Update TODO/status docs only when the repository state proves a status change.
- Preserve each file's established voice, structure, and format. For static
  HTML, retain the existing design system and accessibility patterns.
- Edit generated documentation at its source, then run the repository's
  generator. Update committed outputs through that pipeline; do not hand-edit
  derived files.
- Keep mirrors and localized docs aligned when the repository's workflow
  requires it. Report content that needs a human translator or domain owner.
- Change "last updated" dates only when content changed and the project uses
  that convention.

If documentation contradicts implementation and the correct product behavior
is unclear, stop that claim from shipping and report the discrepancy. Do not
change product behavior merely to make the docs pass unless the user asked.

## 4. Verify the release

- Run the repository's prescribed docs generation, formatting, lint, link,
  example, and build checks.
- Run broader validation when docs contain executable examples, generated API
  output, or files consumed by the product build.
- If no docs checks exist, at minimum:
  - run `git diff --check`;
  - inspect relative links and referenced local files in changed docs;
  - search for superseded names, versions, commands, and paths identified from
    the release;
  - render or build changed static pages when a local workflow exists.
- Review the final diff for accidental mass rewrites, generated-file drift,
  unsupported claims, broken navigation, and unrelated edits.
- Re-run deterministic generators when practical and confirm they produce no
  further changes.

Fix documentation failures in scope. Clearly distinguish pre-existing failures
from failures introduced by the release.

## 5. Hand off

Report:

- the release scope used;
- documentation surfaces checked;
- files updated and outputs regenerated;
- validation commands and results;
- unresolved gaps, ownership needs, or publish steps.

Do not commit, tag, publish, deploy, or push unless the user explicitly asks.
