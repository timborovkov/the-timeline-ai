import Link from 'next/link';

import type { Metadata } from 'next';

import { LegalPage } from '@/components/legal-page';
import { CookieSettingsButton } from '@/components/public-analytics';
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
              <strong>tl_analytics_consent</strong>, a first-party cookie lasting up to 180 days.
            </td>
            <td>
              Remember the version, accepted or rejected analytics choice, and choice time. A
              rejection contains no PostHog, account, user, team, session, or device identifier.
            </td>
          </tr>
          <tr>
            <td>
              <strong>tl_public_attribution</strong>, a first-party cookie lasting up to 30 days,
              created only after analytics is accepted and a reviewed UTM parameter is present.
            </td>
            <td>
              Remember the first reviewed source, medium, campaign category, and first-touch time
              for registration attribution. Only reviewed categories, including an explicit “other”
              category, are stored. Unknown or free-text values, click IDs, and other query values
              are discarded.
            </td>
          </tr>
          <tr>
            <td>
              <strong>ph_timeline_public_analytics_v1</strong> in local storage, created only after
              analytics is accepted on an eligible public page. PostHog can also keep bounded
              session-window keys with that prefix.
            </td>
            <td>
              Maintain a pseudonymous public-site visitor and session for manual, allowlisted
              PostHog events. It is not identified, aliased, or grouped to an account, user, or
              team, and it is cleared when analytics is rejected or withdrawn.
            </td>
          </tr>
          <tr>
            <td>
              <strong>tl_posthog_consent_v1</strong> in local storage after analytics is accepted on
              an eligible public page. It remains until Timeline removes it, the value is replaced,
              or browser data is cleared.
            </td>
            <td>
              Let the PostHog SDK apply the separate Timeline analytics choice without sending an
              opt-in event. Timeline removes it when analytics is rejected or withdrawn and before
              entering a private app route.
            </td>
          </tr>
          <tr>
            <td>
              Legacy <strong>am_vid</strong>, <strong>am_sid</strong>, and <strong>am_st</strong>
              values may remain in browsers that previously loaded the removed Convex-hosted page
              tracker.
            </td>
            <td>
              Current source no longer writes or sends these values. Rejecting or withdrawing in
              Cookie settings clears them. Historical provider data and the old deployment still
              require an operator review before any deletion claim.
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
      <h2>2. Optional public browser analytics</h2>
      <p>
        The source-controlled Cookie settings control records a separate analytics choice. Reading
        this notice alone does not accept analytics. If this deployment has no reviewed PostHog
        browser key, the control reports analytics as unavailable and cannot record an acceptance
        that silently activates later.
      </p>
      <p>When optional analytics is configured and accepted:</p>
      <ul>
        <li>
          PostHog loads only on source-allowlisted public marketing, help-article, Trust, and legal
          pages after a separate affirmative choice.
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
          A separate server counter may keep personless surface-request totals for broad public page
          categories. It does not carry a browser, visitor, session, user, or team identifier. Bots
          and retries can contribute, so these totals are not visitor or session metrics. An
          analytics rejection does not disable this separate count.
        </li>
      </ul>
      <p>
        A public PostHog identity is pseudonymous, not anonymous. Production region, retention,
        account access, contract, deletion, and configuration evidence must still be verified before
        stronger deployment claims are made.
      </p>

      <h2>3. Implementation and deployment status</h2>
      <p>
        Repository controls can enforce the browser boundary, but they cannot prove provider-account
        or production settings. The analytics owner must verify the remaining deployment values.
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
            <td>tl_analytics_consent; first party; service-wide path; up to 180 days.</td>
          </tr>
          <tr>
            <td>PostHog browser storage</td>
            <td>
              Local-storage-only persistence named ph_timeline_public_analytics_v1; exact provider
              retention remains unverified.
            </td>
          </tr>
          <tr>
            <td>PostHog project host, processing region, and account access</td>
            <td>
              EU Cloud project reviewed 26 August 2026. Production access and deployment evidence
              remain incomplete — do not enable optional browser analytics yet.
            </td>
          </tr>
          <tr>
            <td>Event and property allowlist</td>
            <td>
              Manual public_page_viewed and public_cta_clicked events with fixed surface and action
              values. Project-level client IP discard is enabled; production payload evidence
              remains open.
            </td>
          </tr>
          <tr>
            <td>Provider retention, deletion workflow, DPA, and transfer safeguard</td>
            <td>
              Pay-as-you-go currently documents seven-year product-event retention, which exceeds
              Timeline's 90-day target. Legacy deletion is queued; completion, DPA, and transfer
              evidence remain open — do not enable optional browser analytics yet.
            </td>
          </tr>
          <tr>
            <td>Deployed date, responsible owner, and production canary</td>
            <td>Not yet recorded — repository implementation is not production evidence.</td>
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
        Use Cookie settings to accept, reject, or withdraw optional public analytics. Rejecting and
        accepting are equally available when PostHog is configured. Withdrawal stops future browser
        collection and clears Timeline's public PostHog, attribution, and legacy Convex tracker
        storage from this browser. It does not change the lawfulness of earlier processing or
        automatically erase provider records already received.
      </p>
      <p>
        <CookieSettingsButton className="inline-flex rounded-sm border border-border px-3 py-2 font-medium text-fg hover:bg-surface" />
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
      description="What The Timeline stores in your browser, what is necessary for the service, and how to control optional public analytics."
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
