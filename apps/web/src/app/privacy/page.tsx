import { TIMELINE_AI_PRIVACY_POLICY_VERSION } from '@timeline/shared/llm';
import Link from 'next/link';

import type { Metadata } from 'next';

import { LegalPage } from '@/components/legal-page';
import {
  LEGAL_ADDRESS,
  LEGAL_EFFECTIVE_DATE,
  LEGAL_PROVIDER,
  LEGAL_REGISTRY_CODE,
  PRIVACY_VERSION,
  getLegalContactEmail,
} from '@/lib/legal-versions';
import { publicMetadata } from '@/lib/public-metadata';
import { PUBLIC_TRANSCRIPTION_PRIVACY_CLAIMS } from '@/lib/trust-claims';

export const metadata: Metadata = publicMetadata({
  title: 'Privacy Policy',
  description: 'How The Timeline collects, uses, shares, protects, and retains personal data.',
  path: '/privacy',
});

export const dynamic = 'force-dynamic';

type LegalContactEmail = ReturnType<typeof getLegalContactEmail>;

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

function PrivacyOverviewSections({ legalContactEmail }: { legalContactEmail: LegalContactEmail }) {
  return (
    <>
      <p>
        This Privacy Policy explains how {LEGAL_PROVIDER} (“Timeline”, “we”, “us”, or “our”)
        processes personal data when you visit our websites, create an account, join a team, contact
        us, or use The Timeline service. Our plain-language <Link href="/trust">Trust page</Link>{' '}
        summarizes the same operating model, and our{' '}
        <Link href="/cookies">Cookies and similar technologies notice</Link> lists current browser
        storage and the release conditions for optional analytics. This Policy controls if those
        pages differ.
      </p>

      <h2>1. Who is responsible for the data?</h2>
      <p>
        For our website, account administration, service operations, security, product analytics,
        and direct support, the data controller is {LEGAL_PROVIDER}, Estonian registry code{' '}
        {LEGAL_REGISTRY_CODE}, {LEGAL_ADDRESS}. Contact us at{' '}
        <a href={`mailto:${legalContactEmail}`}>{legalContactEmail}</a>.
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
      <p>
        The analytics bases below are our current intended positions and remain subject to qualified
        privacy and legal review before this version is published in production.
      </p>
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
        these roles fail closed instead of falling back to an endpoint with weaker retention. The
        production key must be restricted to the code-owned model catalog and attested to this exact
        policy version. Prompt logging, input/output sharing, Broadcast, and persistent response
        caching must remain disabled. Repository code cannot independently prove those account
        settings, so the deployment evidence must be captured before publication of a verified
        hosted guarantee. OpenRouter may retain non-content request metadata such as model, token
        count, cost, latency, and account identifiers for operations and billing.
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
        that setting as deleting provider media after one hour, but the deployed account,
        request-level setting, and deletion-failure handling must be verified before relying on
        completed deletion. The resulting transcript, timestamps, speakers, and derived Timeline
        records remain in the workspace until an authorized user deletes them or a valid deletion
        request applies. Recall.ai separately documents seven-day retention for operational logs and
        removal of meeting URLs 14 days after a bot terminates.
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
              Application and worker hosting; PostgreSQL and Redis services; private-network server
              traffic and persistent volumes for Qdrant and RustFS; and an external HTTPS endpoint
              for authorized, short-lived signed RustFS browser transfers. Buckets are not public.
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
            <td>Postmark</td>
            <td>
              Transactional and inbound email, invitations, and support messages. Postmark retains
              message content according to the configured account period (seven-day minimum; 45-day
              default) and states that stored message content is not encrypted at rest.
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
              Project region, retention, DPA, deletion, access, and deployed account settings still
              require dated provider evidence.
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
        </tbody>
      </table>

      <h2>8. Customer-directed integrations</h2>
      <p>
        A team may choose to connect services such as Slack, Telegram, GitHub, Google Drive, Linear,
        Monday.com, Sentry, calendar providers, custom webhooks, and custom MCP servers. We exchange
        data with them only when configured or invoked by the customer and according to the
        permissions granted. Those providers act under their own terms and privacy notices for their
        services. Disconnecting a source stops future access but does not automatically erase
        records already captured into Timeline.
      </p>
    </>
  );
}

function PrivacyDisclosureAndSecuritySections() {
  return (
    <>
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
        The separate Convex deployment, historical data, and live production release still require
        verification before we treat that incident as closed.
      </p>
      <p>
        Browser PostHog is limited to eligible public pages after a separate affirmative choice and
        does not run in protected workspace routes. Rejecting or withdrawing results in no PostHog
        browser event, cookie, local-storage value, session identifier, or visitor identifier from
        that point forward. Autocapture, heatmaps, and session replay remain off. Separate
        server-to-server surface events continue regardless of the browser choice. Eligible,
        allowlisted, non-prefetch public navigations share one non-visitor stream identifier;
        eligible app navigations count only after Auth.js permits the request and share another.
        Only an allowlisted surface is variable, so these events cannot recognize a returning
        visitor or account. Sentry error monitoring and Cloudflare Turnstile abuse prevention are
        separate processing, not PostHog analytics.
      </p>
      <p>
        The source includes the public-route consent and withdrawal controls, but browser capture
        remains disabled when its public project key is absent. Provider account settings,
        retention, processing region, access, and the production deployment remain separate evidence
        items. We do not use behavioral advertising trackers.
      </p>

      <h2>11. Human access to Customer Content</h2>
      <p>
        Timeline personnel do not routinely browse team workspaces. Production access is restricted
        to authorized personnel who need it for a user-requested support case, service reliability,
        security response, legal compliance, or another documented operational purpose. Access must
        be minimum-necessary, time-bounded where practicable, and subject to confidentiality.
        Product roles do not give a team administrator a general bypass into another member&apos;s
        private items.
      </p>

      <h2>12. Security</h2>
      <p>
        Measures include encrypted external transport, isolated private-network traffic between
        hosted services, team-scoped database and vector queries, per-record visibility checks,
        encrypted integration secrets using authenticated encryption, signed or authenticated
        webhooks, short-lived or controlled file access, audit records for security-relevant product
        actions, and review of external content before it reaches the agent. No system can be
        guaranteed completely secure. See the <Link href="/trust">Trust page</Link> for a concise
        explanation.
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
            <td>Raw meeting media at Recall.ai</td>
            <td>
              Timeline requests one-hour retention; raw media is not copied into Timeline object
              storage. Recall.ai documents seven-day operational-log retention and removal of
              meeting URLs 14 days after bot termination. Production request/account evidence and
              deletion-failure handling remain subject to verification.
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
            <td>Operational, security, support, and email records</td>
            <td>
              Only as long as reasonably needed for the purpose, contractual commitments, fraud and
              incident investigation, or applicable legal requirements.
            </td>
          </tr>
        </tbody>
      </table>
      <p>
        Deletion from an active system may not immediately remove data from backup or recovery
        copies where those copies are configured, or from immutable security records. The existence,
        schedule, retention, and deletion behavior of deployed backups depends on the production
        configuration and must be verified. Law may also require preservation. We may retain
        de-identified information that cannot reasonably be linked back to an individual.
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

function PrivacyRightsAndClosingSections({
  legalContactEmail,
}: {
  legalContactEmail: LegalContactEmail;
}) {
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
        Send requests to <a href={`mailto:${legalContactEmail}`}>{legalContactEmail}</a> or use our{' '}
        <Link href="/help/support">private support form</Link>. Do not put account details or a
        privacy request in a public GitHub issue. You also have the right to complain to your local
        supervisory authority or the{' '}
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
        Privacy requests and questions:{' '}
        <a href={`mailto:${legalContactEmail}`}>{legalContactEmail}</a>. Provider: {LEGAL_PROVIDER},{' '}
        Estonian registry code {LEGAL_REGISTRY_CODE}, {LEGAL_ADDRESS}.
      </p>
    </>
  );
}

export default function PrivacyPage() {
  const legalContactEmail = getLegalContactEmail();

  return (
    <LegalPage
      eyebrow={`Version ${PRIVACY_VERSION} · Effective ${LEGAL_EFFECTIVE_DATE}`}
      title="Privacy Policy"
      description="How The Timeline collects, uses, shares, protects, and retains personal data—including content processed by AI and connected services."
    >
      <PrivacyOverviewSections legalContactEmail={legalContactEmail} />
      <PrivacyAiAndProviderSections />
      <PrivacyDisclosureAndSecuritySections />
      <PrivacyRetentionSections />
      <PrivacyRightsAndClosingSections legalContactEmail={legalContactEmail} />
    </LegalPage>
  );
}
