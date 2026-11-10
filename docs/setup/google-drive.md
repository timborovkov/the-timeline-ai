# Google Drive

Timeline uses a server-side OAuth web flow and requests Drive read-only access. Google scopes are requested by the authorize URL, but the OAuth consent screen must be configured for external/internal use before non-test users can connect. Use the same OAuth client as [Google sign-in](google-sign-in.md); Drive still requests its own read-only scopes from Connections and does not share the sign-in callback.

1.  In [Google Cloud Console → APIs & Services → Credentials](https://console.cloud.google.com/apis/credentials), create an OAuth 2.0 client with type *Web application*.

2.  Under **Authorized redirect URIs**, add: `https://thetimeline.cc/api/auth/callback/google` (sign-in) and `https://thetimeline.cc/api/integrations/google_drive/callback` (Drive). Authorized JavaScript origins are not used by Timeline's server-side callback flow.

3.  Enable the Google Drive API, the Google Sheets API, and the Google Docs API for the project. Native Sheets capture reads every tab through Sheets API `spreadsheets.get` / `values.batchGet` under existing `drive.readonly` (Drive `files.export` `text/csv` is first-sheet-only). Native Docs capture reads every tab, including nested child tabs, through Docs API `documents.get?includeTabsContent=true&suggestionsViewMode=PREVIEW_WITHOUT_SUGGESTIONS` under the same scope (Drive `files.export` `text/plain` is not documented as covering the Docs tabs feature; Docs API without that flag is first-tab-only; omitting `suggestionsViewMode` would hash pending suggested inserts as committed). No extra OAuth scope is requested.

4.  Ensure the OAuth consent screen allows these scopes: `openid`, `email`, `profile`, and `https://www.googleapis.com/auth/drive.readonly`. Sign-in uses `openid`, `email`, and `profile` only. Drive requests `openid`, `email`, and `drive.readonly`. `drive.readonly` already covers file content and metadata for the Drive, Docs, and Sheets calls Timeline makes, so `drive.metadata.readonly` is not requested. Both of those Drive scopes are restricted under Google’s current Drive API scope table; requesting the extra metadata scope would still be a restricted-scope verification item. `openid` supplies the stable Google subject identifier used to reconnect the same account; `email` supplies its display label. Verification is Cloud-project scoped: a second OAuth client in the same project does not isolate restricted-scope review.

5.  Copy the OAuth client id and client secret from the credential details page.

6.  Set:

        GOOGLE_CLIENT_ID=...
        GOOGLE_CLIENT_SECRET=...
        # REQUIRED before accepting Drive webhooks. 32+ bytes of randomness.
        GOOGLE_DRIVE_WEBHOOK_SECRET=...

7.  Restart the web + worker services. The provider appears in the native catalog when the required credentials are configured.

8.  Any team member can connect their Google Drive account from the Google Drive row on Connections (`/app/connections/sources`) or `/app/me/connections`. Opening the Drive details sheet shows accounts, the resource picker, visibility, and team sync. The picker can browse My Drive, folders, shared drives, and specific Docs, Sheets, Slides, PDF, and Word files. Only those selections are read. My Drive root resolves `/files/root` to the real folder id and walks ancestry to that folder — Drive never puts the `root` alias in production `parents`. Shared with me is not admitted. A team admin activates shared Drive sources from the same sheet and may optionally link a watched folder or file to a Timeline object.

9.  Drive uses push `changes.watch`, not polling. Register the site domain for Drive push notifications and set `GOOGLE_DRIVE_WEBHOOK_SECRET` (32+ bytes). The channel token is `<integration_id>.<HMAC-SHA256(GOOGLE_DRIVE_WEBHOOK_SECRET, integration_id)>`; the route is `/api/webhooks/google-drive`. The HTTP handler only records the delivery and enqueues `webhook-delivery`. That worker asks the provider for a targeted `drive.changes` job (the same webhook-delivery + targeted `integration-sync` path GitHub and Monday use). The Drive changes job lists the account feed, keeps in-scope files, and enqueues one delayed `drive.file` job per file. Folder ACL changes schedule permission refreshes for tracked descendants whose stored ancestry includes that folder rather than discarding the folder change. BullMQ `jobId` coalesces bursts; `replaceDelayed` extends the quiet window the same way conversation-review bumps `quietUntil` (about 15 minutes, at most one hour from the first notification).


## Capture and recovery

Selected file changes become cited timeline evidence; full Drive documents are not harvested into the document drive. Native Docs/Sheets capture every tab; PDF/Office extraction uses the credential-thin document extractor. Processing and extraction budgets may defer work.

[Drive lifecycle](../architecture/drive.md) owns change detection, selection inheritance, transactional rebinding, retries and cleanup. [Google OAuth readiness](../research/google-oauth-readiness.md) owns publication evidence. Disconnect revokes/removes the connection as allowed by shared sign-in authorization; it does not erase captured history.

For failed extraction, inspect the integration audit and worker health, fix configuration and retry through the existing recovery path. Never clear cursors or S3 objects manually to force progress.


Shared prerequisites, health and resync: [integrations](integrations.md).
