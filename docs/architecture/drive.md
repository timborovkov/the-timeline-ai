# Drive capture lifecycle

Provider setup is in [Drive setup](../setup/google-drive.md); personal connection and team-share authority follow ADR 0008. This contract owns the implementation invariants, not deployment instructions.

- Persist the extract cursor before enqueue. Retain cancellation tombstones through the producer wait, even when S3 reports a missing object; a late producer may still write.
- Disconnect, deselection and unsupported/removed files use the same coverage-aware cleanup. Fail closed while a producer can publish; retry deletion without discarding cleanup evidence.
- Reuse a persisted extract result on retry. A transient S3 timeout/5xx must not consume a paid slot, mark extraction failed, or destroy resumable state. Revision changes invalidate superseded extraction.
- Advance content/comment/permission baselines only when all required changed evidence was stored. Full-text hash changes cannot be dismissed because the retained prefix is unchanged. Bound diff work; split evidence or defer rather than dropping spans or changed comments.
- A relevance judge’s noise verdict cannot discard an unambiguous paired change to a whole-line owner, assignee, status, deadline, due date, launch date, budget or approved-budget field. Compare values with cosmetic-edit rules against complete before/after text, independently of contextual hunks. Incomplete previous snapshots and duplicate labels do not qualify. Log `drive_change_noise_overridden` with field names only. Other prose still uses the judge; synthetic/demo labels alone do not make meaningful changes noise.
- Keep latest text only for change detection; older retained states are hashes-only. Remove snapshots on disconnect or loss of coverage. Recapture updates ordering and ancestry even when content repeats.
- File events use revision/occurrence-aware dedupe. A→B→A→B must preserve the second B while retries of one revision remain idempotent.
- Object links use explicit file, then nearest linked selected ancestor precedence. A shared-drive match cannot bypass a nearer folder; My Drive root applies only to its descendants.
- Selection changes and artifact rebinding share a transaction. Rebind only the affected file's hard anchors; preserve sibling files, immutable raw evidence and canonical-object anchors. Merged object links resolve to the survivor.
- Required capture services are assembled at the provider boundary; missing persistence cannot become a successful no-op. Browsing is not selection authorization.
- Processing/extract budgets schedule durable delayed continuations. File-only work must not claim the shared changes feed has recovered. Lock-blocked retries acknowledge only after enqueue succeeds.
- Native Docs and Sheets capture all tabs through their APIs; suggested Docs inserts are not committed evidence. Preserve URLs, identifiers, signed values and negation during normalization.
- Shared sign-in/Drive OAuth grants follow the revoke policy: disconnect must not silently invalidate unrelated sign-in authorization. OAuth registration metadata is scoped to its authentication attempt.

Implementation owners: `packages/shared/src/integrations`, worker integration/extraction lifecycle modules, and their scoped regression suites. Do not copy parser constants or every regression example into setup instructions.
