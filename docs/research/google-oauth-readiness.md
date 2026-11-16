# Google OAuth readiness (technical evidence)

OAuth registration metadata is scoped to one Auth.js configuration invocation.
The approved sign-in callback and account-creation event share a single-use
attempt context; no process-global email mailbox carries verification claims.
Missing attempt metadata does not establish email verification.

This note records what the Drive branch **code** requests and why. It is not a
Google Cloud Console submission, CASA packet, or approved-status claim.

Checked out implementation: `cursor/google-drive-v1-b571`. Sign-in with Google
and Google Drive share `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`. Do not split
Cloud projects to isolate verification: Google reviews restricted scopes at
**project** level. A second client in the same project does not isolate it.

## Requested scopes

### Sign-in with Google (OIDC)

Exact authorize params from `apps/web/src/lib/oauth-sign-in.ts`:

- `openid`
- `email`
- `profile`
- `include_granted_scopes=false` (does not inherit Drive scopes)
- no `access_type=offline`, no `prompt=consent`

Callback path: `/api/auth/callback/google`  
Documented production URI: `https://thetimeline.cc/api/auth/callback/google`  
Local: `http://localhost:3000/api/auth/callback/google`

### Google Drive connection

Exact authorize scopes from `GOOGLE_DRIVE_OAUTH_SCOPES` in
`packages/shared/src/integrations/providers/google-drive.ts`:

- `openid`
- `email`
- `https://www.googleapis.com/auth/drive.readonly`

Authorize URL: `https://accounts.google.com/o/oauth2/v2/auth` with
`access_type=offline` and `prompt=consent`.  
Token URL: `https://oauth2.googleapis.com/token`.  
Identity: `https://www.googleapis.com/oauth2/v3/userinfo` (`sub` required).

Callback path: `/api/integrations/google_drive/callback`  
Documented production URI: `https://thetimeline.cc/api/integrations/google_drive/callback`  
Local (from `appUrl()`, not a separate Console screenshot):
`http://localhost:3000/api/integrations/google_drive/callback`

Consent-screen extras for the **shared** client (sign-in only): `profile`.

`drive.metadata.readonly` is **not** requested. Google classifies both
`drive.readonly` and `drive.metadata.readonly` as restricted
([Choose Google Drive API scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth)).
`drive.metadata.readonly` forbids file content. Every implemented Drive call
needs content or is already covered by `drive.readonly`.

Internal job/resource kind `drive.file` is **not** the Google OAuth scope
`https://www.googleapis.com/auth/drive.file`. Folder-level `changes.watch` /
`changes.list` plus later-added children is the product reason for
`drive.readonly` instead of per-file `drive.file`. That redesign is out of
scope.

## Enabled Google APIs actually used

| API | Code path |
| --- | --- |
| Drive v3 | `files.list`, `files.get`, `files.export` / `alt=media`, `changes.startPageToken`, `changes.list`, `changes.watch`, `comments.list`, `permissions.list`, `drives.list`, `files/root` |
| Docs v1 | `documents.get?includeTabsContent=true&suggestionsViewMode=PREVIEW_WITHOUT_SUGGESTIONS` |
| Sheets v4 | `spreadsheets.get`, `values.batchGet` |
| OAuth userinfo | `https://www.googleapis.com/oauth2/v3/userinfo` |
| OAuth revoke | `https://oauth2.googleapis.com/revoke` after personal Drive disconnect, only when safe |

Webhook (not OAuth): `POST /api/webhooks/google-drive` → documented
`https://thetimeline.cc/api/webhooks/google-drive`. Console push-notification
domain allowlist is operator-only.

## Disclosure

Connections catalog, native Connect/Reconnect, and Drive reconnect open
`GoogleDriveConnectDisclosure` before `/api/integrations/google_drive/start`.
Copy lives in `apps/web/src/lib/google-drive-limited-use.ts`. Continue to Google
is the affirmative action; Cancel or dismiss does not start OAuth. Google’s
API Services User Data Policy requires prominent, timely in-product notice.
Workspace user-data policy lists checkbox as **one example** of affirmative
action, not a unique mandate. This product does not treat a duplicate checkbox
as required.

Privacy (`/privacy`) and the public connector page
(`/integrations/google-drive`) name use, storage, sharing, deletion, billed
change-judging, document extract, Limited Use, and no general-model training.

## Token revoke

Deleting a personal Drive connection (`deleteOwnedProviderConnection`) always
drops encrypted local tokens. It then POSTs Google revoke **only if**:

1. a decryptable refresh or access token exists, and
2. no Auth.js `accounts` row has `provider=google` and
   `providerAccountId=<Drive sub>`, and
3. no other `provider_connections` row is still `google_drive` for that `sub`.

Google’s revoke endpoint invalidates the **project grant**, so revoking Drive
while Sign in with Google is linked would break sign-in. Skip is intentional.
Revoke network/`5xx` failure is logged and does **not** fail the local
disconnect.

## Retained Google-sourced events

Team-source disconnect deletes Drive snapshots, latest extracted text, and extract
objects. Personal connection removal deletes credentials and disables dependent
sources, but does not perform that snapshot cleanup. Captured `raw_events` stay.
Source-ingested event **content** is
immutable. The `sourceMetadata.deleted` flag is for provider-side deletions
(Slack/Telegram), not a user “erase this integration history” control.

No bulk Drive-event purge is introduced. The
[manual support process](../setup/manual-support-deletion.md) covers requests,
case-specific removal, citations, evidence, vectors, backups, and verification.
Existing controls include team export and coverage-aware snapshot cleanup;
unsupported removal operations require engineering escalation. A synthetic
rehearsal remains outstanding, and G-13 is not closed by documenting the process.

## Demo script (verification video)

Use a test Google account on `https://thetimeline.cc` (or the deployed Drive
branch host). Record without customer data.

1. Sign in (credentials or Google OIDC). Show that Sign in does not mention Drive.
2. Open Connections → Google Drive → Connect.
3. Show the in-app disclosure (access, use, storage, sharing, deletion, AI
   processors, Limited Use, Privacy Policy link). Click Continue to Google.
4. Complete Google consent for read-only Drive. Return to Connections.
5. Select a folder that contains a Doc and a Sheet. Save shares. Have an admin
   activate the source.
6. Edit the Doc, wait for the quiet window / changes path, show a cited
   timeline event.
7. Show personal connection removal (credentials removed, dependent sources
   disabled) separately from team-source disconnect (snapshot/extract cleanup).
   The cited event **remains** after either action. Show Help → Support for a
   separate manual deletion request; do not claim personal removal deletes snapshots.
8. Open Google Account → Third-party access and show remaining Timeline grant
   if Sign in with Google is still linked (expected skip of programmatic revoke).

## Operator GCP checklist (not done by code)

Console configuration is unverified from this repository.

1. OAuth user type External (or Internal, if Workspace-only — different path).
2. Consent screen app name, logo, homepage `https://thetimeline.cc`, privacy
   `https://thetimeline.cc/privacy`, support email. Terms URL only if
   `LEGAL_PUBLICATION_READY=true` actually publishes `/terms` in production.
   This note does not set that flag.
3. Authorized redirect URIs: both production callbacks above; add localhost
   URIs only for local clients.
4. Consent-screen scopes: `openid`, `email`, `profile`,
   `https://www.googleapis.com/auth/drive.readonly`. Remove
   `drive.metadata.readonly` if it is still listed from an earlier draft.
5. Enable Drive API, Google Docs API, Google Sheets API.
6. Drive push-notification domain for
   `https://thetimeline.cc/api/webhooks/google-drive`.
7. Restricted-scope verification for `drive.readonly`, including justification
   mapped to folder `changes.watch` / selected-source capture in this note.
8. Security assessment / CASA as Google requires for restricted Drive scopes
   when storing that data on servers.
9. Demo video from the script above.
10. Do not publish to Production/external users before Google completes that
    review. Testing + allowlisted test users is the safe interim.

The operator controls publication through `LEGAL_PUBLICATION_READY`. This change
does not publish Terms.
