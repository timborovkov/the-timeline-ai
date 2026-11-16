# Google sign-in

Sign in with Google uses the same OAuth web client as Google Drive (`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`). Auth.js handles the callback at `/api/auth/callback/google`. The sign-in request asks only for `openid`, `email`, and `profile`. It never requests Drive scopes, never sets `access_type=offline`, and does not inherit previously granted Drive access. Connecting Drive stays a separate flow on Connections. The Google button appears on sign-in and sign-up only when both client values are configured.

Account linking follows the existing Auth.js rule, tightened for Google: a Google profile may attach to an existing Timeline user only when Google asserts a verified email *and* that Timeline email is already verified. Unverified emails are never linked automatically. New Google users and workspaces follow the same first-time OAuth path as GitHub (solo team, welcome email, invite cookie, publication gate). When Google asserts `email_verified`, Timeline stamps `users.emailVerified` and skips the verification-email token. Credentials sign-up still requires that token. The same stamp unlocks the person-level Free grant. GitHub sign-up does the same when GitHub provides a verified primary (or other verified) email.

Add both production redirect URIs on the shared client: `https://thetimeline.cc/api/auth/callback/google` and `https://thetimeline.cc/api/integrations/google_drive/callback`. Local development also needs `http://localhost:3000/api/auth/callback/google`.

<span id="google-drive"></span>

Shared prerequisites, health and resync: [integrations](integrations.md).
