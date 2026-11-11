import { TIMELINE_AI_PRIVACY_POLICY_VERSION } from '@timeline/shared/llm';
import Link from 'next/link';

import type { Metadata } from 'next';

import { LegalPage } from '@/components/legal-page';
import { SupportMailto } from '@/components/support-email-provider';
import {
  LEGAL_ADDRESS,
  LEGAL_PROVIDER,
  LEGAL_REGISTRY_CODE,
  PRIVACY_VERSION,
  PRIVACY_EFFECTIVE_DATE,
} from '@/lib/legal-versions';
import { publicMetadata } from '@/lib/public-metadata';
import { PUBLIC_TRANSCRIPTION_PRIVACY_CLAIMS } from '@/lib/trust-claims';

export const metadata: Metadata = publicMetadata({
  title: 'Privacy Policy',
  description: 'How The Timeline collects, uses, shares, protects, and retains personal data.',
  path: '/privacy',
});

function TranscriptionRetentionSources() {
  const sources = PUBLIC_TRANSCRIPTION_PRIVACY_CLAIMS.retentionSources;
  if (sources.length === 0) return null;

  return (
    <>
      {' '}
      Source policies:{' '}
      {sources.map((source, index) => (
        <span key={source.href}>
          {index > 0 ? '; ' : null}
          <a href={source.href}>{source.label}</a>
        </span>
      ))}
      .
    </>
  );
}

function PrivacyOverviewSections() {
  return (
    <>
      <p>
        This Privacy Policy explains how {LEGAL_PROVIDER} (“Timeline”, “we”, “us”, or “our”)
        processes personal data when you visit our websites, create an account, join a team, contact
        us, or use The Timeline service. Our technical <Link href="/trust">Trust page</Link>{' '}
        summarizes the same operating model, and our{' '}
        <Link href="/cookies">Cookies and similar technologies notice</Link> lists current browser
        storage and your choices for optional analytics. This Policy controls if those pages differ.
      </p>

      <h2>1. Who is responsible for the data?</h2>
      <p>
        For our website, account administration, service operations, security, product analytics,
        and direct support, the data controller is {LEGAL_PROVIDER}, Estonian registry code{' '}
        {LEGAL_REGISTRY_CODE}, {LEGAL_ADDRESS}. Contact us at <SupportMailto />.
      </p>
      <p>
        For messages, documents, recordings, transcripts, integration records, and other content
        submitted to a team workspace (“Customer Content”), the customer organization normally
        decides why and how that data is used. The customer is the controller and Timeline acts as
        its processor. Individual team members should first direct workspace-data requests to their
        organization. We will assist the customer as required by applicable law and our agreement.
      </p>

      <h2>2. Data we collect</h2>
      <ul>
        <li>
          <strong>Account data:</strong> name, email address, profile image, authentication method,
          email-verification state, legal-acceptance records, and account preferences.
        </li>
        <li>
          <strong>Team and permission data:</strong> team names, memberships, roles, invitations,
          selected visibility, settings, approvals, connection ownership, and audit records.
        </li>
        <li>
          <strong>Customer Content:</strong> notes, messages, email, files, document versions,
          meeting transcripts, calendar events, integration records, prompts, agent conversations,
          extracted facts, vectors, summaries, suggestions, objects, tasks, and citations.
        </li>
        <li>
          <strong>Connection data:</strong> provider account identifiers, selected resources,
          webhook metadata, OAuth tokens, API credentials, and custom MCP configuration. Secrets are
          stored encrypted, not as readable plaintext.
        </li>
        <li>
          <strong>Authorized-app data:</strong> OAuth client identity and callback metadata, the
          selected team and approved scopes, credential digests and prefixes, issue and expiry
          times, revocation state, and security audit records for MCP hosts a member authorizes.
        </li>
        <li>
          <strong>Service and device data:</strong> IP address, user agent, timestamps, request and
          response metadata, job status, security signals, diagnostics, personless surface-request
          events, and explicit pseudonymous product lifecycle events. If you allow optional public
          browser analytics, this category can also include the consent preference and approved
          public-page events and identifiers described in our cookies notice. We do not
          intentionally place Customer Content in product analytics.
        </li>
        <li>
          <strong>Communications:</strong> support requests, sales questions, feedback, and related
          correspondence and attachments.
        </li>
      </ul>

      <h2>3. Where data comes from</h2>
      <p>
        We receive data from you; other members of your team; your employer or organization; the
        authentication, communication, meeting, storage, calendar, developer, and work-management
        services you choose to connect; and automatically from your browser or device when needed to
        operate and secure the service. A team must have authority to connect a source and submit
        data about other people.
      </p>

      <h2>4. Purposes and legal bases</h2>
      <table>
        <thead>
          <tr>
            <th scope="col">Purpose</th>
            <th scope="col">Legal basis when GDPR applies</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Provide accounts, teams, capture, storage, retrieval, AI features, and support.</td>
            <td>Performance of a contract or steps requested before entering one.</td>
          </tr>
          <tr>
            <td>Secure the service, prevent abuse, debug failures, and protect legal rights.</td>
            <td>
              Our legitimate interests in operating a safe and reliable service, and legal
              obligations where applicable.
            </td>
          </tr>
          <tr>
            <td>Send transactional messages, invitations, and requested service notices.</td>
            <td>Contract performance and our legitimate interest in service communication.</td>
          </tr>
          <tr>
            <td>Evaluate approved, content-free product lifecycle events and improve workflows.</td>
            <td>
              Our legitimate interest in improving the service, balanced against user privacy.
            </td>
          </tr>
          <tr>
            <td>
              Run optional PostHog browser analytics on eligible public pages after you allow it.
            </td>
            <td>
              Consent obtained before PostHog initializes. Policy acknowledgement, account creation,
              and necessary storage are not that consent.
            </td>
          </tr>
          <tr>
            <td>
              Count requested public pages and signed-in product surfaces through fixed, non-visitor
              server streams.
            </td>
            <td>
              Our legitimate interest in understanding basic service operation, where that count
              constitutes personal-data processing. The event contains an allowlisted surface only
              and cannot recognize a browser, visitor, session, account, user, or team.
            </td>
          </tr>
          <tr>
            <td>Comply with law, valid legal process, and regulatory requirements.</td>
            <td>Legal obligation or legitimate interests, depending on the request.</td>
          </tr>
        </tbody>
      </table>
      <p>
        Where we rely on consent, you may withdraw it at any time without affecting earlier lawful
        processing. We do not treat acknowledgement of this Policy as consent to processing that
        requires a separate choice.
      </p>
    </>
  );
}

function PrivacyAiAndProviderSections() {
  return (
    <>
      <h2>5. AI processing, privacy, and training</h2>
      <p>
        Hosted Timeline sends only the content needed for the requested feature to OpenRouter, which
        routes it to an eligible upstream inference endpoint. This covers generation, extraction,
        summarization, embeddings, media text extraction, and transcription. Model families may
        change as quality and availability change; current exact model IDs and their roles are
        published on the <Link href="/trust">Trust page</Link>.
      </p>
      <p>
        Model privacy policy {TIMELINE_AI_PRIVACY_POLICY_VERSION} classifies{' '}
        {PUBLIC_TRANSCRIPTION_PRIVACY_CLAIMS.privacyZdrRoleList} as zero-data-retention required.
        Supported requests send <code>data_collection: deny</code>, <code>zdr: true</code>, and an
        explicit cache-disable control. OpenRouter may select among eligible ZDR upstreams, but
        these roles fail closed instead of falling back to an endpoint with weaker retention. Our
        policy requires prompt logging, input/output sharing, Broadcast, and persistent response
        caching to remain disabled. Request controls do not independently verify provider-account
        settings or provider deletion. OpenRouter may retain non-content request metadata such as
        model, token count, cost, latency, and account identifiers for operations and billing.
      </p>
      <p>
        {PUBLIC_TRANSCRIPTION_PRIVACY_CLAIMS.privacyDetail}
        <TranscriptionRetentionSources />
      </p>
      <p>
        We do not use Customer Content to train or fine-tune any model, or to build model-training
        datasets. Creating customer-specific embeddings for retrieval is service processing, not
        model training. We also disable rich prompt-and-output observability tracing in hosted
        production. AI output can be inaccurate; Timeline keeps citations so users can inspect the
        underlying evidence.
      </p>

      <h2>6. Meetings, recordings, and transcripts</h2>
      <p>
        If a team enables meeting capture, Recall.ai joins as a visible bot and processes meeting
        media to produce a transcript. Host consent confirmation is required by default. Customers
        remain responsible for participant notices and any consent required by law, contract, or
        workplace policy.
      </p>
      <p>
        Timeline does not copy raw meeting audio or video into its object storage. Hosted Timeline
        requests Recall.ai&apos;s one-hour media-retention setting for each bot. Recall.ai documents
        that setting as deleting provider media after one hour. The requested setting is not
        confirmation of completed provider deletion. The resulting transcript, timestamps, speakers,
        and derived Timeline records remain in the workspace until an authorized user deletes them
        or a valid deletion request applies. Recall.ai separately documents seven-day retention for
        operational logs and removal of meeting URLs 14 days after a bot terminates.
      </p>

      <h2>7. Service providers</h2>
      <p>
        We use processors to deliver the service. They may process data only for the relevant
        purpose and subject to their agreements with us. Depending on the deployed configuration and
        the features a customer enables, core hosted-service providers include:
      </p>
      <table>
        <thead>
          <tr>
            <th scope="col">Provider</th>
            <th scope="col">Purpose and data</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Railway</td>
            <td>
              Application and worker hosting; PostgreSQL and Redis services; and persistent volumes
              for Qdrant and RustFS. Application file transfers use team authorization and
              short-lived signed URLs.
            </td>
          </tr>
          <tr>
            <td>OpenRouter and eligible inference endpoints</td>
            <td>{PUBLIC_TRANSCRIPTION_PRIVACY_CLAIMS.privacyProviderPurpose}</td>
          </tr>
          <tr>
            <td>Recall.ai</td>
            <td>Meeting-bot attendance, temporary meeting media, and transcript capture.</td>
          </tr>
          <tr>
            <td>Daytona</td>
            <td>
              Ephemeral, isolated document-extraction compute for supported file formats. Sandbox
              state is discarded when the sandbox stops, while Daytona retains observability logs,
              traces, and metrics for three days.
            </td>
          </tr>
          <tr>
            <td>Firecrawl (SideGuide Technologies, Inc.)</td>
            <td>
              When you request a website scan or enable a recurring schedule, Timeline sends the
              public website URL a user submits to Firecrawl so Firecrawl can fetch up to five
              public pages and return markdown. Timeline does not send workspace records, account
              passwords, or private logged-in pages. Firecrawl&apos;s published privacy policy names
              the operator as SideGuide Technologies, Inc. d/b/a Firecrawl and states that its
              servers are in the United States. Firecrawl documents that crawl job results remain
              retrievable from its API for 24 hours after completion. Broader retention of fetched
              page content beyond that documented API window is to be confirmed. Timeline does not
              enable Firecrawl&apos;s Enterprise zero-data-retention option. See Firecrawl&apos;s{' '}
              <a href="https://www.firecrawl.dev/privacy-policy">privacy policy</a> and{' '}
              <a href="https://docs.firecrawl.dev/security">security overview</a>. Deleting data in
              Timeline does not by itself delete copies Firecrawl holds. Websites about clients,
              partners, or other companies may include other people&apos;s public information.
              Timeline stores the website URL, schedule, scan status and usage, and captured pages
              as cited evidence and versioned document snapshots. Current answers prefer the latest
              successfully processed page version; historical evidence remains available. Pausing or
              removing a website source stops future scans without erasing earlier captures.
              Timeline may suggest records for your approval. To request removal of captured pages,
              snapshots, and derived information, contact the workspace administrator or contact us
              using the details in this policy. We coordinate applicable deletion requests with the
              workspace and processors; deleting a document alone does not remove all captured
              evidence, backups, or processor copies.
            </td>
          </tr>
          <tr>
            <td>Resend</td>
            <td>
              Timeline sends transactional product email through Resend from the verified domain{' '}
              <code>in.thetimeline.cc</code> in the <code>eu-west-1</code> sending region (for
              example noreply@in.thetimeline.cc). Current types are team invitations, support
              requests, welcome messages, email verification, password reset, daily digests,
              connection-attention notices, and billing usage alerts. Timeline does not use Resend
              audiences, contacts, segments, broadcasts, topics, automations, or Resend templates.
              Inbound receiving is enabled on the same domain. Resend posts a signature-verified{' '}
              <code>email.received</code> webhook to{' '}
              <code>https://thetimeline.cc/api/email/inbound</code>; a worker then fetches the body
              and attachments from Resend&apos;s receiving API and stores them in the workspace.
              Open tracking and click tracking are currently enabled at the domain level. Timeline
              does not set per-send tracking flags. Resend states that customer data is stored in
              the United States regardless of sending region. Resend&apos;s published documentation
              for its Free, Pro, and Scale plans states that email and log data are retained for 30
              days while the account is active and deleted within 90 days after termination. See
              Resend&apos;s <a href="https://resend.com/security/gdpr">GDPR documentation</a>,{' '}
              <a href="https://resend.com/legal/dpa">DPA</a>, and{' '}
              <a href="https://resend.com/legal/subprocessors">subprocessor list</a>. Deleting data
              in Timeline does not by itself delete copies Resend holds during that window; earlier
              deletion of Resend copies requires a request to Resend.
            </td>
          </tr>
          <tr>
            <td>Sentry</td>
            <td>
              Error reporting and diagnostics. Default PII collection is disabled, and Timeline
              strips cookies, authorization and sensitive headers, URL query strings and fragments,
              invitation tokens, and Telegram bot tokens. Diagnostic text can still reach Sentry;
              arbitrary exception and breadcrumb text is not guaranteed to be content-free.
            </td>
          </tr>
          <tr>
            <td>PostHog</td>
            <td>
              Personless server surface-request events, pseudonymous content-free product events,
              and optional public-browser analytics. The personless streams use one fixed
              non-visitor identifier each and receive only an allowlisted surface. Product-action
              identifiers are transformed before capture and are not anonymous. Browser PostHog may
              initialize only after affirmative consent on an eligible public page and is never
              identified or grouped to an account, user, or team. Autocapture, heatmaps, session
              replay, DOM capture, automatic page views, and client-side feature flags are disabled.
              PostHog documents seven-year product-event retention on its pay-as-you-go plan;
              Timeline does not promise a shorter provider retention period.
            </td>
          </tr>
          <tr>
            <td>Cloudflare Turnstile</td>
            <td>Abuse prevention on public forms and email/password registration.</td>
          </tr>
          <tr>
            <td>GitHub (authentication, when configured)</td>
            <td>
              Basic GitHub profile, email, and account identifiers used to sign in. This is separate
              from a team&apos;s optional GitHub content integration.
            </td>
          </tr>
          <tr>
            <td>Google (authentication, when configured)</td>
            <td>
              OpenID email and profile identifiers used to sign in. Sign-in requests only{' '}
              <code>openid</code>, <code>email</code>, and <code>profile</code> — never Google Drive
              scopes. Connecting Drive remains a separate Connections flow.
            </td>
          </tr>
        </tbody>
      </table>

      <h2>8. Customer-directed integrations</h2>
      <p>
        A team may choose to connect services such as Slack, Telegram, GitHub, Google Drive, Linear,
        Monday.com, Sentry, calendar providers, custom webhooks, and custom MCP servers. We exchange
        data with them only when configured or invoked by the customer and according to the
        permissions granted. Those providers act under their own terms and privacy notices for their
        services.
      </p>
      <p>Disconnecting access and deleting captured records are different actions:</p>
      <ul>
        <li>
          <strong>Personal account or OAuth disconnect:</strong> A member can remove their own
          provider account from Timeline. Timeline deletes the encrypted credentials stored for that
          connection. For Google Drive, Timeline also requests that Google revoke the grant when no
          remaining Drive connection or Google sign-in on this project still needs it. Workspace
          sources that used that account are disabled until a replacement connection is chosen. This
          does not cancel provider watches or webhooks by itself, and it does not delete captured
          timeline events, documents, Drive change snapshots, or extracted text.
        </li>
        <li>
          <strong>Workspace source removal:</strong> A team admin can disconnect a workspace source.
          Timeline stops future capture from that source, deletes the source configuration and
          related sync records, and attempts to cancel provider-managed watches or webhooks where
          that cleanup is implemented (Google Drive change watches and Monday.com webhooks). Other
          providers&apos; app-level or manually configured webhooks are not uninstalled by this
          action. For Google Drive sources, Timeline also cancels in-flight document extraction and
          deletes Drive change snapshots, the latest extracted text kept for change detection, and
          transient extract files. Already-captured timeline events and uploaded documents remain.
        </li>
        <li>
          <strong>Deletion of captured history or documents:</strong> Members can soft-delete
          documents they can access; the document is hidden and can be restored, and stored bytes
          and search chunks are not immediately purged. Calendar events can be deleted in the
          product. Captured source events remain immutable workspace evidence. Disconnecting a
          connection or source does not erase that history. There is no complete self-serve erasure
          of an account, workspace, or every derived index, backup, or processor copy.
        </li>
      </ul>
      <h3>Google Drive</h3>
      <p>
        Connecting Google Drive is separate from Sign in with Google. Drive requests{' '}
        <code>openid</code>, <code>email</code>, and{' '}
        <code>https://www.googleapis.com/auth/drive.readonly</code>. Sign-in requests only{' '}
        <code>openid</code>, <code>email</code>, and <code>profile</code>.
      </p>
      <p>
        Timeline uses selected Drive files, metadata, comments, and sharing signals to create cited
        timeline events after a quiet editing window. OAuth tokens are encrypted at rest. Timeline
        keeps hashes and the latest extracted text to detect later edits, then deletes that
        extracted text on team-source disconnection, file removal, or when remaining selections no
        longer cover the file. Full Drive copies are not stored in the document drive. You choose
        which folders or files a team may use; a team admin activates those sources. Captured events
        follow Timeline visibility rules. Timeline does not edit Drive files or change Drive
        sharing.
      </p>
      <p>
        A small billed model may read changed passages to judge whether they belong on the work
        record. PDF, Word, and Slides text is extracted by Timeline’s document-extract service, then
        deleted. Timeline does not use Google user data to train general-purpose models. Timeline’s
        use of information received from Google APIs adheres to the Google API Services User Data
        Policy, including the Limited Use requirements.
      </p>
      <p>
        Removing your personal Drive account deletes Timeline’s encrypted Drive tokens and, when no
        remaining Drive connection or Google sign-in still needs the grant, requests Google
        revocation. Sources using that account are disabled. It does not delete their snapshots or
        captured history. The personal connection may remain available to other sources. An admin
        disconnect of the workspace Drive source deletes change snapshots and latest extracted text
        for uncovered files, cancels in-flight extraction, and stops Drive change watches when
        deprovision succeeds. Cited timeline events already captured stay in the workspace. Neither
        action is a complete purge of every derived index, backup, or processor copy. You can also
        remove Timeline in Google Account permissions.
      </p>
      <p>
        To request deletion of captured Google Drive data, use our{' '}
        <Link href="/help/support">support form</Link> or contact <SupportMailto />. We handle
        requests manually after checking identity and workspace authority and confirming the scope.
        The review includes captured records and derived data such as search indexes. We explain
        applicable retention, backup expiry, or provider follow-up and confirm what has been
        completed. This is a support-assisted process, not an automatic purge on disconnect. See{' '}
        <Link href="/help/integrations">integration help</Link> for instructions.
      </p>
      <p>
        A member may also authorize ChatGPT, Claude, Codex, or another MCP-compatible client to
        request data from one selected team. The <strong>read</strong> scope can return team-visible
        content, the authorizing member&apos;s private content, and content shared specifically with
        that member, but only where the member can access it at the time of the request.
      </p>
      <p>
        The separate <strong>agent:ask</strong> scope can be approved only by a current team owner
        or admin. It lets the client ask the Timeline agent using team-visible context, create
        team-visible proposals for review, and use enabled team tools. Those tools may act on
        third-party services and can have external side effects. This scope does not give the client
        general team-administration access.
      </p>
      <p>
        The authorized app receives the content returned in response to its requests and may process
        or retain it under the app operator&apos;s own terms and privacy policy. Revoking access
        stops future Timeline requests, but it does not delete copies the app already received.
        Timeline uses PKCE for this authorization flow, stores digests instead of plaintext
        authorization codes and access or refresh tokens, and never sends your Timeline password to
        the app.
      </p>
    </>
  );
}

function PrivacyDisclosureAndSecuritySections() {
  return (
    <>
      <p>
        For paid workspaces, Polar handles checkout, payment methods, invoices, tax and subscription
        administration as merchant of record. We send account contact details, workspace
        identifiers, selected plan and billing usage needed to administer the purchase. Polar
        processes payment and billing records under its own legal obligations and{' '}
        <a href="https://polar.sh/legal/privacy">privacy policy</a>. Timeline receives subscription
        and payment status; do not send payment-card details through support.
      </p>
      <h2>9. When we disclose data</h2>
      <p>We may disclose personal data:</p>
      <ul>
        <li>within the team according to team, private, and specific-user visibility;</li>
        <li>to the processors and customer-directed services described above;</li>
        <li>at the customer&apos;s instruction or when the user asks us to perform an action;</li>
        <li>
          when required by valid law or legal process, or when reasonably necessary to protect
          users, the public, our rights, or the integrity of the service; and
        </li>
        <li>
          in a merger, financing, acquisition, reorganization, or sale of assets, subject to
          appropriate confidentiality and notice where required.
        </li>
      </ul>
      <p>We do not sell personal data or share it for cross-context behavioral advertising.</p>

      <h2>10. Cookies, local storage, and analytics</h2>
      <p>
        We use necessary cookies or browser storage for authentication, security, team selection,
        invitation continuity, requested chat handoffs, and user preferences. The dedicated{' '}
        <Link href="/cookies">Cookies and similar technologies notice</Link> lists current names,
        purposes, and lifetime criteria. Reading that notice or accepting this Policy is not consent
        to optional browser analytics.
      </p>
      <p>
        A previous source version loaded a Convex-hosted page tracker globally. It could create
        persistent browser and session identifiers and send full URLs, referrers, campaign
        parameters, language, screen dimensions, scroll depth, and time on page. The current source
        removes that script and guards the root layout against another hard-coded remote tracker.
        Removing browser storage does not establish deletion of data previously received by the
        provider.
      </p>
      <p>
        Browser PostHog is limited to eligible public pages after a separate affirmative choice and
        does not run in protected workspace routes. Rejecting or withdrawing results in no PostHog
        browser event, cookie, local-storage value, session identifier, or visitor identifier from
        that point forward. Autocapture, heatmaps, and session replay remain off. Consented
        pageviews include only reviewed public page paths and referring website origins, without
        query strings, fragments, page titles, or referrer paths. These support visitors, pageviews,
        referrers, and popular-page reports. Browser identities are not connected to accounts or
        teams. Separate server-to-server surface events continue regardless of the browser choice.
        Eligible, allowlisted, non-prefetch public navigations share one non-visitor stream
        identifier; eligible app navigations count only after Auth.js permits the request and share
        another. Only an allowlisted surface is variable, so these events cannot recognize a
        returning visitor or account. Sentry error monitoring and Cloudflare Turnstile abuse
        prevention are separate processing, not PostHog analytics.
      </p>
      <p>
        Cookie settings lets you accept, reject, or withdraw optional public-browser analytics.
        Browser capture remains disabled when its public project key is absent. We do not use
        behavioral advertising trackers.
      </p>

      <h2>11. Human access to Customer Content</h2>
      <p>
        Timeline&apos;s staff access policy prohibits routine browsing of team workspaces and
        permits production access only for user-requested support, service reliability, security
        response, legal compliance, or another documented operational purpose. The policy requires
        access limited to what the task needs, time-bounded access where practicable, and
        confidentiality. Product roles do not give a team administrator a general bypass into
        another member&apos;s private items.
      </p>
      <p>
        For those permitted purposes, specifically authorized Timeline personnel may use a temporary
        support session as a selected member of one team. This can include reading that
        member&apos;s private content and making changes within the member&apos;s permissions. The
        session does not grant access to other members&apos; private content that the selected
        member cannot see. This staff-access capability is separate from customer team-owner and
        administrator roles.
      </p>
      <p>
        These support sessions expire after 30 minutes and can be ended earlier. Ordinary support
        requires customer authorization; emergency incident access is subject to subsequent review.
        We record the purpose, ticket or incident reference, authorization or emergency context,
        staff and member identities, selected team, session times, and relevant access and actions.
        These records support accountability and incident investigation. Session expiry ends access;
        it does not immediately delete the associated records. We do not copy workspace content or
        credentials into these audit records. Inspection of suspended accounts or teams is
        read-only.
      </p>

      <h2>12. Security</h2>
      <p>
        Application controls include team-scoped database and vector queries, per-record visibility
        checks, encrypted integration secrets using authenticated encryption, signed or
        authenticated webhooks, short-lived or controlled file access, audit records for
        security-relevant product actions, and review of external content before it reaches the
        agent. Our hosting policy requires encrypted external transport and private networking
        between hosted services. No system can be guaranteed completely secure. See the{' '}
        <Link href="/trust">Trust page</Link> for a concise explanation.
      </p>
    </>
  );
}

function PrivacyRetentionSections() {
  return (
    <>
      <h2>13. Retention and deletion</h2>
      <table>
        <thead>
          <tr>
            <th scope="col">Data</th>
            <th scope="col">Typical criterion</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Account, membership, and legal-acceptance data</td>
            <td>
              While the account or team relationship is active, then as needed for security, legal,
              dispute, and compliance records.
            </td>
          </tr>
          <tr>
            <td>Customer Content and derived indexes</td>
            <td>
              While the customer keeps it in Timeline, subject to supported deletion and export
              workflows and backup or recovery copies where configured.
            </td>
          </tr>
          <tr>
            <td>Google Drive snapshots and tokens</td>
            <td>
              Encrypted Drive tokens are deleted when the member disconnects their Drive account;
              dependent sources are disabled. Change snapshots and latest extracted text are deleted
              when an admin removes the workspace Drive source or when remaining selections no
              longer cover a file. Cited Drive timeline events remain with other Customer Content
              until a support-assisted deletion request is completed.
            </td>
          </tr>
          <tr>
            <td>Raw meeting media at Recall.ai</td>
            <td>
              Timeline requests one-hour retention; raw media is not copied into Timeline object
              storage. Recall.ai documents seven-day operational-log retention and removal of
              meeting URLs 14 days after bot termination. The requested setting is not confirmation
              of completed provider deletion.
            </td>
          </tr>
          <tr>
            <td>Daytona document-extraction observability</td>
            <td>
              Three days for provider logs, traces, and metrics; ephemeral sandbox state is
              discarded when the sandbox stops.
            </td>
          </tr>
          <tr>
            <td>AI prompt and response content at inference providers</td>
            <td>{PUBLIC_TRANSCRIPTION_PRIVACY_CLAIMS.privacyRetentionDetail}</td>
          </tr>
          <tr>
            <td>Authorized MCP-app grant and token digests</td>
            <td>
              Revoking an authorized app immediately marks its grant and credentials inactive.
              Expired authorization-code digests are eligible for deletion after their ten-minute
              validity window. Access- and refresh-token digests remain until the associated
              refresh-token expiry, up to 30 days from that token pair&apos;s issue, so attempted
              reuse can still be detected. Revoked grant records are eligible for deletion after 31
              days and only after their code and token rows have been removed. Public-client
              registration metadata and security audit records may be retained after revocation;
              those retained records do not allow the app to regain access.
            </td>
          </tr>
          <tr>
            <td>Temporary staff support-session records</td>
            <td>
              Eligible for deletion 30 days after the session ends or expires, whichever happens
              first. This includes the token digest and recorded purpose and authorization context;
              session access itself lasts at most 30 minutes.
            </td>
          </tr>
          <tr>
            <td>Platform administration and staff-access audit records</td>
            <td>
              Eligible for deletion 12 months after each record is created. This includes recorded
              staff and member identities, affected teams, purpose and authorization context, ticket
              or incident references, management actions, and support-session access and activity.
              This audit evidence can remain after the session record is deleted. We do not copy
              workspace content or credentials into these records.
            </td>
          </tr>
          <tr>
            <td>Email at Resend</td>
            <td>
              Outbound transactional email and inbound messages processed by Resend. Open tracking
              and click tracking are currently enabled at the domain level. Resend states that, on
              its Free, Pro, and Scale plans, email and log data are retained for 30 days while the
              account is active and deleted within 90 days after termination. Deleting a Timeline
              record does not itself delete the Resend copy during that window.
            </td>
          </tr>
          <tr>
            <td>Operational, security, support, and email records</td>
            <td>
              Only as long as reasonably needed for the purpose, contractual commitments, fraud and
              incident investigation, or applicable legal requirements.
            </td>
          </tr>
        </tbody>
      </table>
      <p>
        Scheduled maintenance removes eligible platform support-session and audit records on its
        next successful run. A documented legal hold delays deletion of affected records until the
        hold is released; a hold does not extend session access. Hold documentation is retained
        while active and becomes eligible for deletion 12 months after release. These periods apply
        to active systems, not separately retained backup copies described below.
      </p>
      <p>
        Deletion from an active system may not immediately remove data from backup or recovery
        copies where those copies are configured, or from immutable security records. The existence,
        schedule, retention, and deletion behavior of deployed backups depends on the production
        configuration. Deleting active records does not guarantee immediate deletion from those
        copies. Law may also require preservation. We may retain de-identified information that
        cannot reasonably be linked back to an individual.
      </p>

      <h2>14. International transfers</h2>
      <p>
        Our company is established in Estonia, but providers and customer-directed integrations may
        process data in other countries. Before a GDPR-restricted transfer, it must be covered by an
        adequacy decision, approved standard contractual clauses, or another lawful safeguard as
        applicable. Contact us to confirm the currently executed safeguards relevant to your data
        before submitting data that depends on a particular transfer mechanism.
      </p>
    </>
  );
}

function PrivacyRightsAndClosingSections() {
  return (
    <>
      <h2>15. Your rights and choices</h2>
      <p>
        Depending on applicable law, you may request access, correction, deletion, portability, or
        restriction; object to processing based on legitimate interests; or withdraw consent. You
        may also close connections, change visibility, or ask your organization to act on workspace
        data. We may verify identity and authority before acting. Some rights are limited where an
        exemption applies or retention is legally required.
      </p>
      <p>
        The Cookie settings control lets you reject or withdraw optional public-browser analytics as
        easily as you accepted. This browser choice does not govern the separately disclosed
        personless surface streams, pseudonymous server/worker product analytics, Sentry, security
        logs, or necessary service storage. See the <Link href="/cookies">cookies notice</Link> for
        the browser-storage inventory.
      </p>
      <p>
        To request deletion of personal data or assistance with workspace Customer Content, email{' '}
        <SupportMailto /> or use our <Link href="/help/support">private support form</Link>. Do not
        put account details or a privacy request in a public GitHub issue. We will verify identity
        and authority before acting. Timeline does not currently provide a complete self-serve admin
        or support console that erases every store. After we process a valid request, copies can
        remain in backups or recovery systems where those are configured, in security and audit
        logs, in legal, billing, and tax records, and in processor systems until those providers
        complete their own deletion. Email copies at Resend remain subject to Resend&apos;s
        published retention window unless Resend is asked to delete them earlier. We do not publish
        a deletion-completion SLA for those residual copies. Law may require us to retain some
        records. You also have the right to complain to your local supervisory authority or the{' '}
        <a href="https://www.aki.ee/en/guidelines-legislation/how-can-we-help-foreign-persons-and-authorities">
          Estonian Data Protection Inspectorate
        </a>
        .
      </p>

      <h2>16. Children and sensitive data</h2>
      <p>
        The service is intended for professional use and not for children under 16. The hosted
        Service is not approved for special-category personal data, protected health information,
        government identifiers, financial account credentials, or other highly regulated data. Do
        not submit any such data unless Timeline has given express prior written approval for the
        specific data and use case. Our written approval is mandatory in every case, even if your
        organization has determined that it has a lawful basis and appropriate safeguards. Timeline
        is not currently presented as HIPAA-compliant.
      </p>

      <h2>17. Automated decision-making</h2>
      <p>
        Timeline uses AI to organize information and propose or generate answers, but it is not
        intended to make decisions producing legal or similarly significant effects about people.
        Customers must provide appropriate human review for consequential decisions.
      </p>

      <h2>18. Changes to this Policy</h2>
      <p>
        We may update this Policy as the product, providers, or law changes. We will publish the new
        version and effective date. If a change is material or requires renewed acknowledgement,
        signed-in users will be asked to review the updated Terms and Privacy Policy before using
        the protected product again. We keep acceptance history to show which version a user
        accepted and when.
      </p>

      <h2>19. Contact</h2>
      <p>
        Privacy requests and questions: <SupportMailto />. Provider: {LEGAL_PROVIDER}, Estonian
        registry code {LEGAL_REGISTRY_CODE}, {LEGAL_ADDRESS}.
      </p>
    </>
  );
}

export default function PrivacyPage() {
  return (
    <LegalPage
      eyebrow={`Version ${PRIVACY_VERSION} · Effective ${PRIVACY_EFFECTIVE_DATE}`}
      title="Privacy Policy"
      description="How The Timeline collects, uses, shares, protects, and retains personal data—including content processed by AI and connected services."
    >
      <PrivacyOverviewSections />
      <PrivacyAiAndProviderSections />
      <PrivacyDisclosureAndSecuritySections />
      <PrivacyRetentionSections />
      <PrivacyRightsAndClosingSections />
    </LegalPage>
  );
}
