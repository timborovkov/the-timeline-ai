# Open work

This is the prioritised index of unresolved outcomes. Detailed acceptance criteria live in the linked owner; do not copy them here. Remove an item when its outcome is verified, preserving any unfinished subtask as its own item. Source implementation does not close deployment, provider-account or legal evidence gaps.

## Release and operating gates

| ID | Open outcome | Completion evidence / owner |
| --- | --- | --- |
| R1 | Verify release configuration and migration lineage for each deployment. | Confirm deployed revision/branch and migrations using [Railway](docs/railway.md) and [migration lineage](docs/migrations/coworker-drive-order.md); do not assume historical branch observations are current. |
| R2 | Complete task-category production readiness. | [ADR 0011](docs/adr/0011-task-category-is-reversible-derived-state.md): live classifier/eval, staging backfill/query plans, and pilot latency/correction/project-link thresholds. |
| R3 | Promote evidence packs per adapter. | [Rollout gates](docs/relational-memory.md#cross-source-evidence-rollout): remaining adapters, shadow sample, safety/quality/cost/latency evidence, monitoring and explicit enforcement. |
| R4 | Verify hosted MCP and publish the intended directories. | [Publication runbook](docs/marketplace-submissions.md): real-host OAuth/tool smoke tests, reviewer/support readiness, approval and visible listing; coworker client acceptance remains separately evidenced. |
| R5 | Close security/privacy and legal evidence gaps. | The sole gap register is [security gaps](docs/security-gaps.md), including license/DPA/legal review, exact-text acceptance, analytics/legacy Convex, provider controls, staff access, backups and deletion. Do not duplicate individual gaps here. |
| R6 | Complete billing production acceptance before enabling charges. | [Polar setup](docs/setup/polar.md): real webhook, shadow reconciliation period and invoice/member-access verification. Resolve or explicitly retain the provider's legacy customer-email limitation. No wallet/auto-reload flow is planned. |
| R7 | Establish backup automation and recovery evidence. | [Operations](docs/operations.md): secondary object-storage copies, vector snapshots, Postgres retention, isolated restore drill, named operator and recurring schedule; cross-reference security gap G-06. |
| R8 | Complete operational monitoring. | Queue/failure/retrieval freshness and provider-spend dashboards with actionable alerts, documented ownership and a tested response path. |

| R9 | Verify the Drive project-field noise safeguard in production. | Deploy and capture a fresh Doc edit; the missed 9 November Doc event will not reappear on redeploy because its noise verdict advanced the comparison snapshot. See [Drive lifecycle](docs/architecture/drive.md). |

## Product gaps

| ID | Open outcome | Completion criterion / owner |
| --- | --- | --- |
| P1 | Add per-team vision-spend budgets and visibility. | Bound paid OCR spend before work starts and show deferred/budget state; retain existing extraction admission limits. |
| P2 | Recover terminal failed/no-show meeting captures. | Expose final failure in operations with an explicit retry/rejoin path; existing in-window retry is not full recovery. |
| P3 | Complete remaining timeline moment coverage. | Non-integration source moment IDs, provider live-payload fixtures and handoff/update DTOs; current Moments UI is not a pending redesign. |
| P4 | Improve board-agent workflows after dogfooding. | Board-scoped cited answers distinguish accepted state from proposals; extend only the missing direct operations. |
| P5 | Extend high-risk in-chat approval workflows. | Persist prepared action IDs for multi-step actions and add missing task/board create/archive/pin operations with authorization and retry safety. |
| P6 | Add retrieval/index health by source kind. | Surface stale/missing indexes and recovery for object/calendar/document/board changes without leaking hidden data. |
| P7 | Extend shared agent evaluation to remaining journeys. | Measure gaps in real dashboard/external-chat/background-proposal/summary/action paths using the existing harness; do not build a second harness. |
| P8 | Add external calendar import. | Person-owned encrypted credentials, selected calendars, incremental Google sync/push and CalDAV polling, dedupe, private-source visibility and deletion tombstones. |
| P9 | Add calendar reminders and missed-event handling. | Stateless due-window worker, team/per-event override cascade, idempotent delivery and evidence-based missed-event semantics. |
| P10 | Add targeted file inspection and correction. | Second-pass original-file inspection, audited representation corrections, and captured-file sender/bulk triage; preserve [file semantics](docs/captured-files.md). |
| P11 | Extend captured-work and supporting evidence coverage. | Parent IDs for pulses, GitHub review discussion, document-chunk pack admission and summary refresh, Linear/Monday actor mapping, and later Jira/CRM adapters. Follow [engine authority](docs/relational-memory.md); no semantic-only canonical writes. |
| P12 | Improve residual behavioral test coverage. | Restore/deeper permission/session-isolation paths, real queue/storage/DB contracts and end-to-end first-value/payment/provider flows. Use existing suites; [testing](docs/testing/README.md) owns execution policy. |

| P13 | Verify pre-launch engine against restricted representative Railway events. | Confirm deployed scheduler/worker health and measure labeled identity/relationship precision and recall on real events; synthetic evidence does not close this operational gate. See [engine evaluation](docs/relational-memory.md#evaluation-and-operational-diagnosis). |

## Conditional work

| ID | Decision or dependency | Outcome if pursued |
| --- | --- | --- |
| C1 | WhatsApp account/Groups API eligibility and pilot approval. | [Scoped pilot proposal](docs/whatsapp-groups-implementation-plan.md); forward-only capture, no arbitrary history import. |
| C2 | Real object-relationship usage justifies visualization. | A filtered, density-controlled graph with cited edges; not a prerequisite to relationships. |
| C3 | Customer demand justifies outbound calendar sync. | Best-effort Google push with Timeline authoritative; independent of import. |
| C4 | Enterprise hosts require verified-domain OIDC compatibility. | Implement and verify discovery, UserInfo and verified email before claiming support; base MCP OAuth remains separate. |
| C5 | Production host testing reveals an OAuth compatibility defect. | Assess state/resource interoperability from evidence; never weaken validation speculatively. |
| C6 | DCR registrations accumulate without grants. | Bounded cleanup of unused clients without deleting active grants or token evidence. |
| C7 | A CRM/provider app listing is approved as product scope. | Separate reversible encrypted provider credentials and uninstall lifecycle; update disclosures before enabling write-back. Never reuse hashed MCP-server grants. |
| C8 | Duplicate canonical names within a user-authored object type are needed. | Revisit the partial uniqueness constraint with migration-safe semantics; the current index and UI disambiguation remain intentional. |

## Product validation

Run a closed beta with 3–5 friendly teams. Measure text/voice capture friction (initial targets under 10/15 seconds), cited answer usefulness (initial target over 85% positive), daily object use, and correct-version document answers. Treat these as proposed pilot targets, not achieved metrics. Use findings to choose prompt changes; re-extract only through the bounded runbook.

Recurring backups, rotation, capacity review and isolation checks are procedures in [operations](docs/operations.md), not permanently unchecked roadmap entries.
