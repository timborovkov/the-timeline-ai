import Link from 'next/link';

import type { Metadata } from 'next';

import { LegalPage } from '@/components/legal-page';
import { getLegalContactEmail } from '@/lib/legal-versions';
import { publicMetadata } from '@/lib/public-metadata';

export const metadata: Metadata = publicMetadata({
  title: 'Cookies and similar technologies',
  description:
    'The cookies, browser storage, analytics, and related technologies used by The Timeline.',
  path: '/cookies',
});

export const dynamic = 'force-dynamic';

const REVIEW_DATE = '21 August 2026';

function CurrentBrowserStorage() {
  return (
    <>
      <h2>1. Current cookies and browser storage</h2>
      <p>
        The hosted service uses the following first-party storage to provide requested features.
        Most of it appears only after you sign in or use the relevant feature. Blocking it can stop
        sign-in, team selection, or saved interface preferences from working.
      </p>
      <table>
        <thead>
          <tr>
            <th scope="col">Technology and lifetime</th>
            <th scope="col">Purpose</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <strong>Auth.js cookies</strong>: <strong>authjs.session-token</strong> (30-day
              default session maximum), <strong>authjs.callback-url</strong>, and{' '}
              <strong>authjs.csrf-token</strong>. Relevant sign-in flows can also use 15-minute{' '}
              <strong>authjs.pkce.code_verifier</strong>, <strong>authjs.state</strong>,{' '}
              <strong>authjs.nonce</strong>, and <strong>authjs.challenge</strong> values. HTTPS
              deployments add framework secure prefixes, and large session values can be split into
              numbered cookie chunks. A session ends earlier on sign-out.
            </td>
            <td>
              Keep you signed in and protect authentication flows. Session and security values are
              HTTP-only where the framework permits it.
            </td>
          </tr>
          <tr>
            <td>
              <strong>pending_invite</strong>, a signed HTTP-only cookie lasting 15 minutes.
            </td>
            <td>Preserve an invitation while a user completes an external sign-in flow.</td>
          </tr>
          <tr>
            <td>
              <strong>tl_active_team</strong>, a host-only, HTTP-only, SameSite=Lax cookie lasting
              up to 30 days. It is Secure in production and available across the service path.
            </td>
            <td>
              Remember the selected workspace. The server rechecks membership before using the
              stored team identifier.
            </td>
          </tr>
          <tr>
            <td>
              <strong>timeline_sidebar_expanded</strong>, a cookie lasting up to one year, and{' '}
              <strong>timeline.sidebar.expanded</strong> in local storage until it is replaced or
              browser data is cleared. The cookie is scoped to <strong>/app</strong>, and Timeline
              reads the local-storage preference only in that route area.
            </td>
            <td>Remember whether the signed-in workspace sidebar is expanded.</td>
          </tr>
          <tr>
            <td>
              <strong>tl-theme</strong> in local storage until it is replaced or browser data is
              cleared.
            </td>
            <td>Remember the light, dark, or system appearance preference.</td>
          </tr>
          <tr>
            <td>
              <strong>tl-coachmark:*</strong> in local storage until browser data is cleared.
            </td>
            <td>Remember that a particular in-product hint was dismissed.</td>
          </tr>
          <tr>
            <td>
              <strong>timeline:floating-agent-chat:&lt;team&gt;:session</strong> in local storage
              for no more than seven days. Invalid, legacy, and expired entries are removed; all
              entries in this family are cleared when you sign out through the user menu.
            </td>
            <td>
              Store a chat-session identifier so the floating Ask panel can reopen the same
              conversation. It is an identifier, not the conversation body.
            </td>
          </tr>
          <tr>
            <td>
              <strong>timeline:chat-handoff:&lt;team&gt;</strong> in session storage. It is removed
              when read, ignored after five minutes, and otherwise ends with the tab session.
            </td>
            <td>
              Carry a one-time Ask prompt or page context into the full chat. A prompt can contain
              up to 4,000 characters, so this entry can contain text you typed.
            </td>
          </tr>
          <tr>
            <td>
              <strong>am_vid</strong>, <strong>am_sid</strong>, and <strong>am_st</strong> in local
              storage, written by a legacy Convex-hosted page tracker with persistent visitor and
              session identifiers.
            </td>
            <td>
              This tracker currently loads without an analytics choice and can send the full page
              URL, referrer, campaign parameters, language, screen dimensions, scroll depth, and
              time on page. It violates the approved boundary and is scheduled for removal and
              historical-data review by the analytics owner. This privacy worktree must not be
              deployed on its own.
            </td>
          </tr>
        </tbody>
      </table>
      <p>
        These entries are used to provide a feature, remember a choice, or protect the service. We
        do not treat acceptance of the <Link href="/terms">Terms of Use</Link> or{' '}
        <Link href="/privacy">Privacy Policy</Link> as permission for optional browser analytics.
      </p>
    </>
  );
}

function AnalyticsStatusAndTarget() {
  return (
    <>
      <h2>2. Browser analytics: current status and approved target</h2>
      <p>
        <strong>This is a notice, not a consent control.</strong> Reading this page does not record
        a choice. The current repository does not yet include an analytics-consent preference or a
        working Cookie settings control. It contains a conditional PostHog browser integration in
        protected workspace routes which, when configured, identifies a user and team and can use
        PostHog cookie and local-storage persistence. That does not meet the approved target below.
        The hosted browser key must remain unset until the protected-route integration is removed
        and the consent design is implemented and verified. The legacy Convex tracker listed above
        is a separate, current violation; its runtime removal belongs to the analytics branch.
      </p>
      <p>The approved target for any future optional browser analytics is:</p>
      <ul>
        <li>
          PostHog may run only on eligible public marketing, help, and legal pages, and only after a
          visitor makes a separate affirmative analytics choice.
        </li>
        <li>
          PostHog must not initialize in signed-in or private workspace routes and must never
          receive workspace content, prompts, search terms, file names, user IDs, or team IDs from
          those routes.
        </li>
        <li>
          Rejecting or withdrawing means zero PostHog browser events, cookies, local-storage values,
          session identifiers, or visitor identifiers from that point forward.
        </li>
        <li>
          Autocapture, heatmaps, session replay, and automatic capture outside the approved public
          event allowlist remain off.
        </li>
        <li>
          A separate server counter may keep identifier-free aggregate totals for public pages. It
          records a route bucket and count only—not a browser, visitor, session, user, or team ID—so
          an analytics rejection does not disable that aggregate count.
        </li>
      </ul>
      <p>
        This target is a release condition, not a claim that a consent manager or public-page
        PostHog deployment exists today.
      </p>

      <h2>3. Information required before optional analytics can be enabled</h2>
      <p>
        The analytics owner must replace every “not recorded” value below and verify it against the
        deployed browser, provider account, contract, and deletion path. Until then, optional
        browser analytics must stay disabled.
      </p>
      <table>
        <thead>
          <tr>
            <th scope="col">Required deployment value</th>
            <th scope="col">Current status</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Consent-choice storage name, scope, and lifetime</td>
            <td>Not recorded — do not enable.</td>
          </tr>
          <tr>
            <td>PostHog cookie and local-storage names, scope, and lifetimes</td>
            <td>Not recorded for the approved public-only design — do not enable.</td>
          </tr>
          <tr>
            <td>PostHog project host, processing region, and account access</td>
            <td>Not verified — do not enable.</td>
          </tr>
          <tr>
            <td>Event and property allowlist, IP handling, and geolocation settings</td>
            <td>Not approved for the public-only design — do not enable.</td>
          </tr>
          <tr>
            <td>Provider retention, deletion workflow, DPA, and transfer safeguard</td>
            <td>Not verified — do not enable.</td>
          </tr>
          <tr>
            <td>Deployed date, responsible owner, and passing consent-route tests</td>
            <td>Not recorded — this notice does not claim deployment.</td>
          </tr>
        </tbody>
      </table>
    </>
  );
}

function ChoicesAndOtherServices() {
  return (
    <>
      <h2>4. Choosing, rejecting, and withdrawing</h2>
      <p>
        There is no Cookie settings button on this page because showing a control that does not work
        would be misleading. If optional public browser analytics is enabled later, eligible public
        pages must show a real settings control that makes accepting and rejecting equally
        accessible. The same control must let you withdraw later. Withdrawal must stop future
        PostHog browser collection and remove its browser-side identifiers; it does not change the
        lawfulness of earlier processing or automatically erase provider records already received.
      </p>
      <p>
        You can also delete or block cookies and site storage in your browser. Doing so can sign you
        out, forget your selected team or appearance, dismiss a pending invitation, or clear a
        one-time chat handoff.
      </p>

      <h2>5. Related processing that is separate from optional analytics</h2>
      <ul>
        <li>
          <strong>Sentry:</strong> when configured, Sentry receives minimized error diagnostics to
          protect and debug the service. It is separate from PostHog analytics and is not switched
          on by an analytics choice. Default PII collection is disabled and known cookies,
          credentials, and token-bearing URLs are scrubbed, but unexpected error or breadcrumb text
          can still contain personal data. Project region and retention remain to be verified.
        </li>
        <li>
          <strong>Cloudflare Turnstile:</strong> in production, signup and support forms can load a
          challenge for abuse prevention. Cloudflare processes browser and network signals under its
          own service configuration. It is not advertising analytics.
        </li>
        <li>
          <strong>Server logs:</strong> infrastructure can process request metadata for delivery,
          security, and reliability. Those logs are governed by the Privacy Policy, not an optional
          analytics preference.
        </li>
        <li>
          <strong>Static repository documentation:</strong> some separately served documentation
          currently requests font assets from Fontshare and jsDelivr. Those providers can receive
          ordinary request metadata. This is an open provider-inventory item, not a claim that those
          pages are third-party-free.
        </li>
      </ul>
    </>
  );
}

export default function CookiesPage() {
  const legalContactEmail = getLegalContactEmail();

  return (
    <LegalPage
      eyebrow={`Notice · Last reviewed ${REVIEW_DATE}`}
      title="Cookies and similar technologies"
      description="What The Timeline currently stores in your browser, what is necessary for the service, and the consent boundary required before optional public analytics can be enabled."
    >
      <p>
        This notice supplements our <Link href="/privacy">Privacy Policy</Link> and the concise{' '}
        <Link href="/trust">Trust page</Link>. It covers cookies, local storage, session storage,
        browser analytics, and closely related browser processing in the hosted service. If this
        notice conflicts with the Privacy Policy, the Privacy Policy controls.
      </p>
      <CurrentBrowserStorage />
      <AnalyticsStatusAndTarget />
      <ChoicesAndOtherServices />

      <h2>6. Changes and contact</h2>
      <p>
        We will update this inventory before adding a new browser technology or enabling optional
        analytics. Privacy questions and requests can be sent to{' '}
        <a href={`mailto:${legalContactEmail}`}>{legalContactEmail}</a>. Security and provider
        boundaries are summarized on the <Link href="/trust">Trust page</Link>.
      </p>
    </LegalPage>
  );
}
