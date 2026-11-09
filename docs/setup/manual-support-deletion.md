# Manual support deletion

Status: documented process, not a completed deletion exercise. No automated purge
system is required or introduced. Before representing end-to-end deletion as
verified, rehearse this process with synthetic records and retain the results.
G-13 remains open for unverified stores and provider propagation.

Customers request deletion through `/help/support` or `contact@thetimeline.cc`.
The public instructions are at `/help/integrations`; Privacy and Terms describe
support-assisted deletion separately from disconnect. No fixed completion SLA or
instant backup-erasure promise is made.

## 1. Open and authorize the case

Assign a named support operator and record the request, identity verification,
workspace, provider, requested scope, and date. Verify authority over team-owned
content with the workspace administrator; route individual rights requests to the
privacy owner rather than treating administrator refusal as a final decision.
Do not ask for credentials or document bodies. Identify data by scoped IDs.
Obtain explicit permission before viewing customer content if inspection is
necessary; prefer identifiers and counts. Support access follows
[the privacy operating standard](../security-privacy-trust.md).

Confirm whether the request concerns a personal connection, one team source,
specific files, or all captured history from that source. Do not delete unrelated
team data or another member's private records. Ask whether an export is wanted;
export is optional, and any resulting copy needs its own expiry/deletion tracking.

## 2. Inventory before disconnecting

Record team, connection, integration, provider account, selected resource, and
source-event IDs before removing source metadata. Map provenance to derived
facts, evidence associations/packs, proposals and approved outputs, summaries,
conversation answers, citations, search vectors, presentation caches, document or
meeting artifacts, temporary objects, queued jobs, exports, and provider copies.
Use current schema and source references, not just a text search for a file name.
For mixed-source outputs, decide which data must be removed or regenerated;
review shared/canonical records explicitly rather than cascading blindly.

Capture identifiers/counts, not content, in the case record. Record unknown stores
as unresolved. Do not interpret this inventory list as proof each store contains
data or that existing helpers cover every category.

## 3. Stop recapture and perform source cleanup

Coordinate with the customer before interrupting shared sources. Inventory and
settle or cancel affected running, delayed, retry, and extract work; check for late
writes before and after removal. Do not stop unrelated teams' processing.

- Personal connection removal (`deleteOwnedProviderConnection`) deletes saved
  credentials, disables dependent integrations, and conditionally revokes Google's
  grant when safe for other connections/sign-in. It does not delete snapshots or
  captured history. A shared connection can affect multiple teams.
- A team admin's source disconnect (`deleteIntegration`) cleans up that
  integration's selections, snapshots, sync state and temporary extracts. It can
  fail while extract producers or object cleanup remain outstanding; resolve and
  retry before marking it complete. The personal connection can remain for other
  sources. Keep the case inventory because disconnect removes source metadata.
- Neither action deletes captured event history or original Google Drive files.

## 4. Remove retained data manually

A technical operator prepares a case-specific removal plan from the inventory.
Use existing scoped helpers where they implement the intended operation. Review
exact IDs, team boundaries, expected counts, references, and transaction ordering
before executing any destructive operation. All workspace database operations
must use `withTeam` and its approved modules; all Qdrant operations must use the
team-filtered wrapper. Never use the development wipe/seed commands in production.
Do not rewrite immutable source content to blanks or merely hide it as an erasure
substitute. Do not grant blanket production SQL access to support.

There is currently no complete Drive-history deletion helper. If an inventoried
category lacks an approved scoped removal path, escalate to engineering for a
reviewed, case-specific operation; keep that step open until it is executable and
verified. This is not permission to bypass tenant isolation or a claim that a
manual checklist alone deletes data. It does not require a general-purpose purge
service or customer-facing deletion automation.

Remove the authorized retained records and derivatives, or regenerate mixed-source
outputs without the deleted evidence. Delete corresponding vectors using the
Qdrant source deletion helper with `verifyDeleted` where applicable. Remove
applicable object bytes, cache entries, exports, and queued payloads. Inspect
pending work again so retries cannot recreate the deleted records. Do not assume
SQL cascade, soft deletion, or a successful API response covers other stores.

## 5. Backups, processors and justified retention

Inventory actual deployed backup/snapshot retention and relevant processors.
Record each applicable deletion action or expiry date and retain provider receipts.
If individual removal from a backup is unavailable, document its access restriction
and expiry and require the deletion to be reapplied before restored data is served.
Do not create an untracked content backup as part of this procedure.

Refer legal/security retention decisions to the privacy owner. Record the exact
category, basis, access restriction, owner, and expiry/review date. An exception
must not silently preserve the entire source history. Unknown retention or
provider deletion remains an outstanding action, not a completed-erasure claim.

## 6. Verify and reply

Check the scoped database IDs and references, vector existence, object keys,
queues and caches against the inventory. Test search and citations with the
appropriate member permissions and confirm unrelated records remain. UI absence
alone is insufficient. Record timestamped counts and receipts without content.
Repeat affected checks after in-flight work has settled.

Tell the customer what was removed, what remains and why, any backup expiry or
provider follow-up, and whether capture is still enabled elsewhere. Do not state
“all data deleted” while inventory entries remain unknown or pending. Keep the
case open for follow-up, or distinguish completed active-system removal from
separately tracked expiry. Retain a minimal access-controlled case record under
the applicable support-record retention policy, not copies of deleted content.

## Synthetic rehearsal acceptance

Use a disposable team with a Doc and Sheet, plus an unrelated control source.
Capture an event and derived search evidence; exercise the two disconnect actions
separately. Run the inventory/removal/verification steps, including delayed work
and a mixed-source reference. Record unsupported steps and actual backup/provider
coverage. Only mark the exercised boundaries verified; do not close G-13 wholesale.
