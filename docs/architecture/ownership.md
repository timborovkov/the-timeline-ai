# Domain ownership and invariants

Use this map to locate implementation responsibilities. It is not a task list or a file-by-file inventory. Public workspace access still enters through `withTeam`.

| Concern | Owner and boundary |
| --- | --- |
| Workspace access | `packages/shared/src/team-scope.ts` composition and named scope modules; no direct workspace DB access in adapters. |
| Timeline reads | `timeline/read-scope.ts`; presentation cache persistence is in `timeline-moments/presentation-cache.ts`, separate from inference. |
| Transactional effects | `suggestions/acceptance-transaction.ts` carries outer transaction and after-commit work. Nested savepoints must not publish queue/vector effects before the outer commit. Calendar due-date dispatch shares that collector. |
| Visibility and pins | Owning domains provide visibility predicates and canonical recurring-calendar resolution. Single-item and batch pin eligibility must agree, including hidden parents. |
| Platform access | `platform-admin/workspace-policy.ts` declares capabilities explicitly. No method-name inference or identity replacement during impersonation. |
| Provisioning | `agent-provisioning` owns verified-owner grants, receipts and quotas before a team exists; existing-team reads require normal workspace scope. |
| Retrieval | The shared retrieval request contract owns input vocabulary; MCP, dashboard and chat adapters translate into it. Preserve visibility, provenance and partial-failure disclosure. |
| Reconciliation | Dependency-light core/planner contracts stay separate from dashboard/runtime orchestration. Direct-write provenance has one owner. |
| Redis and queues | `redis/connection.ts` owns connection roles; queue shutdown must not close request-cache/admission connections. Drain consumers before producers/connections. |
| Website scan | [Website scan lifecycle](website-scan.md) owns admission, crawl checkpoints, immutable page snapshots and approval-backed handoffs. |
| Provider lifecycle | Provider adapters own browsing, selection validation and capture protocol; generic sync assembles required services and must not silently omit persistence. |
| Drive | [Drive lifecycle](drive.md) owns snapshots, evidence packing, transient extraction and transactional source-link changes. |
| Messaging | Provider-neutral durable turns, claims and delivery policy; outbound delivery must not depend on inbound orchestration. Provider retries preserve idempotency. [Telegram chat migration](telegram-chat-migration.md) preserves workspace ownership across chat-ID changes. |
| Billing | [Billing contract](billing.md) owns admission, settlement, provider mapping and historical price attribution; setup and conversion belong in the Polar guide. |
| Typed transport | Dependency-light DTO/contracts shared by server and client, with strict API validation and tolerant persisted-state parsing where explicitly required. |
| Worker startup | Queue registration, startup and shutdown inventory is code-owned; do not keep a parallel worker list in prose. |
| Tests and extraction images | Test execution policy is explicit in the manifest; snapshot identity derives from the image recipe/content. Neither depends on ad-hoc regexes or a manual version bump. |

## Authentication and agent authority

Static `tla_` keys use a team-only ZERO_UUID principal; member OAuth grants use the consenting member and current visibility. Capture is a separate scope. Only a current owner/admin can grant `agent:ask`, and demotion invalidates that scope. Synthetic team agents are proposal-only and cannot revise existing proposals, use personal pins or invoke approval-required canonical writes.

`mcp-server/oauth-pre-principal.ts` alone owns global token/client lookup needed to discover a principal and token-possession revocation. Once a principal is known, consent, refresh, listing and revocation use `withTeam(...).mcpOAuth`.

Direct web answers use rich citations; external chat uses the compact shared profile before persistence and delivery. Hosted `timeline.ask` has its separate compact cited MCP profile. Provider outputs and integration snippets remain untrusted and fenced. See [agent coworkers](../agent-coworkers.md) and the [security standard](../security-privacy-trust.md).
