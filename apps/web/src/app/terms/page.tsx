import Link from 'next/link';

import type { Metadata } from 'next';

import { LegalPage } from '@/components/legal-page';
import { isLegalPublicationReady } from '@/lib/legal-publication';
import {
  LEGAL_ADDRESS,
  LEGAL_EFFECTIVE_DATE,
  LEGAL_PROVIDER,
  LEGAL_REGISTRY_CODE,
  LEGAL_SERVICE_URL,
  TERMS_VERSION,
  getLegalContactEmail,
} from '@/lib/legal-versions';
import { publicMetadata } from '@/lib/public-metadata';
import { PUBLIC_TRANSCRIPTION_PRIVACY_CLAIMS } from '@/lib/trust-claims';

export const metadata: Metadata = publicMetadata({
  title: 'Terms of Use',
  description: 'Terms information for access to and use of The Timeline.',
  path: '/terms',
});

export const dynamic = 'force-dynamic';

type LegalContactEmail = ReturnType<typeof getLegalContactEmail>;

function TermsFormationSections() {
  return (
    <>
      <p>
        These Terms of Use (“Terms”) are a binding agreement between {LEGAL_PROVIDER}, Estonian
        registry code {LEGAL_REGISTRY_CODE} (“Timeline”, “we”, “us”, or “our”), and the person or
        organization using The Timeline at {LEGAL_SERVICE_URL} and related services (the “Service”).
        Our <Link href="/privacy">Privacy Policy</Link> explains how personal data is processed, and
        our <Link href="/trust">Trust page</Link> summarizes our security and data practices.
      </p>

      <h2>1. Acceptance and authority</h2>
      <p>
        You must accept the current Terms and acknowledge the current Privacy Policy before using
        protected parts of the Service. These Terms bind you personally. If you expressly accept
        them on behalf of an employer or other organization—or create, purchase, or administer its
        team—you also represent that you have authority to bind that organization; “you” then means
        both you and the organization. If you lack that authority, do not accept on its behalf or
        create, purchase, or administer its team, but you may use a workspace you are personally
        authorized to join.
      </p>
      <p>
        Each user accepts individually. An owner or administrator who creates a team, connects a
        shared source, invites members, or makes organization-level choices represents that the
        organization has authorized those actions. An enterprise order form, data-processing
        agreement, or other written agreement may add customer-specific terms; if it conflicts with
        these Terms, that signed agreement controls for the conflict.
      </p>

      <h2>2. Eligibility</h2>
      <p>
        You must be at least 16 years old and legally capable of entering this agreement. The
        Service is intended for professional and organizational use. You may not use the Service if
        applicable law prohibits us from providing it to you.
      </p>

      <h2>3. The Service</h2>
      <p>
        Timeline is an evidence-backed team memory product. It can capture, import, store, organize,
        search, transcribe, summarize, and cite information from web entry, Telegram, Slack, email,
        documents, meetings, calendars, selected third-party integrations, webhooks, and connected
        MCP servers. Features and supported providers may change over time.
      </p>

      <h2>4. Accounts and credentials</h2>
      <p>
        You must provide accurate account information, keep credentials and recovery methods secure,
        and promptly tell us about suspected unauthorized use. You are responsible for activity
        performed through your account unless caused by our breach of these Terms or our failure to
        use reasonable security. Accounts are personal and may not be shared. We may require email
        verification, multi-step authentication, or other security checks.
      </p>

      <h2>5. Teams, roles, and permissions</h2>
      <p>
        A team is a shared workspace. Owners and administrators are responsible for inviting the
        right people, assigning appropriate roles, reviewing connected sources, and removing access
        when it is no longer needed. Product roles control administrative actions but do not give an
        administrator a general right to read another member&apos;s private content. Items may be
        team-visible, private, or limited to named users; users must select appropriate visibility.
      </p>
      <p>
        When a member leaves or is removed, some team-owned connections or shared capture settings
        may need to be reassigned so the team can continue operating. Private personal content must
        not be made team-visible merely because membership ends, except where the user deliberately
        shared it, the organization owns it under applicable policy, or law and a documented process
        permit the transition.
      </p>
    </>
  );
}

function TermsContentAndAiSections() {
  return (
    <>
      <h2>6. Customer Content and license to operate the Service</h2>
      <p>
        As between you and Timeline, you retain ownership of Customer Content. You grant us a
        worldwide, non-exclusive, limited license to host, copy, transmit, format, index, create
        technical and requested product-derived versions of, and otherwise process Customer Content
        solely to provide, secure, support, and maintain the Service; follow your instructions; and
        comply with law. This license ends when the content is deleted from active systems, subject
        to backup or recovery copies where configured, legal retention, and content shared with
        others before deletion.
      </p>
      <p>
        You represent that you and your organization have all rights, notices, permissions, and
        lawful bases needed for Customer Content and for our processing of it under these Terms. You
        remain responsible for the accuracy, legality, and appropriateness of the content you submit
        and the instructions you give us.
      </p>

      <h2>7. Recording, transcription, and third-party content</h2>
      <p>
        You may use capture and transcription only when lawful. You are responsible for informing
        meeting participants, message participants, employees, contractors, customers, and other
        people and for obtaining any consent required by law, contract, workplace policy, or
        platform terms. A host-consent confirmation in the product is a safeguard, not a substitute
        for your legal obligations. Do not secretly record or import content you are not authorized
        to process.
      </p>

      <h2>8. AI features</h2>
      <p>
        The Service uses AI for transcription, extraction, embeddings, media text extraction,
        summarization, classification, suggestions, and agent answers. Hosted AI requests are routed
        under the privacy controls described in the <Link href="/privacy">Privacy Policy</Link>.
        Timeline does not use Customer Content to train or fine-tune any model. Creating embeddings
        for retrieval is processing for the Service, not model training.
      </p>
      <p>
        {PUBLIC_TRANSCRIPTION_PRIVACY_CLAIMS.privacyZdrRoleList} require zero-data-retention
        processing and cannot downgrade to weaker retention during an outage.{' '}
        {PUBLIC_TRANSCRIPTION_PRIVACY_CLAIMS.termsDetail}
      </p>
      <p>
        AI output can be inaccurate, incomplete, delayed, or based on incomplete evidence. Citations
        help you inspect source material but do not guarantee correctness. You must review output
        before relying on it, especially for decisions affecting legal rights, employment, safety,
        finance, health, or other consequential matters. Timeline is not a provider of legal,
        financial, medical, employment, or other professional advice.
      </p>

      <h2>9. Integrations, agents, and external actions</h2>
      <p>
        You may connect third-party accounts, shared sources, webhooks, and MCP servers. You direct
        us to exchange the data necessary to use them. Their services are governed by their own
        terms, availability, and privacy practices. You are responsible for permissions, resource
        selection, credentials, and charges on those services.
      </p>
      <p>
        Tools made available to an agent may cause external side effects, including creating or
        changing records outside Timeline. Review scopes and approval settings before enabling a
        tool. Disconnecting a source does not automatically delete evidence already captured into
        Timeline. We are not responsible for third-party changes, outages, or data practices outside
        our reasonable control.
      </p>
    </>
  );
}

function TermsResponsibleUseSections({
  legalContactEmail,
}: {
  legalContactEmail: LegalContactEmail;
}) {
  return (
    <>
      <h2>10. Acceptable use</h2>
      <p>You must not use or help others use the Service to:</p>
      <ul>
        <li>
          violate law, sanctions, export controls, court orders, or another person&apos;s rights;
        </li>
        <li>
          secretly monitor, record, profile, harass, discriminate against, or make unlawful
          consequential decisions about people;
        </li>
        <li>submit malware, destructive code, or content designed to manipulate an AI system;</li>
        <li>
          probe, scan, scrape, overload, reverse engineer, or bypass security, rate limits,
          visibility, approvals, authentication, or team isolation, except as law expressly permits;
        </li>
        <li>access another user&apos;s account or content without authorization;</li>
        <li>
          resell or provide the hosted Service to third parties without our written permission;
        </li>
        <li>
          misrepresent AI output as verified human work or remove source context deceptively; or
        </li>
        <li>
          use the Service to develop or train a competing general-purpose model without permission.
        </li>
      </ul>
      <p>
        Report suspected vulnerabilities privately to{' '}
        <a
          href={`mailto:${legalContactEmail}?subject=${encodeURIComponent('[Security] Vulnerability report')}`}
        >
          {legalContactEmail}
        </a>
        ; do not put credentials, Customer Content, or undisclosed exploits in public issues. We may
        rate limit, investigate, or block activity reasonably believed to create risk.
      </p>

      <h2>11. Confidentiality and security responsibilities</h2>
      <p>
        We will use reasonable care to protect non-public Customer Content and will access it only
        as described in the Privacy Policy, your instructions, or law. You must use reasonable
        safeguards appropriate to your content: manage membership, use private visibility when
        needed, protect export links and API keys, review integration scopes, and avoid submitting
        data that the Service is not approved to handle.
      </p>
      <p>
        If either party receives confidential information from the other, it may use that
        information only to perform this agreement and may disclose it only to personnel and
        providers with a need to know and confidentiality obligations, or when legally required.
        Information is not confidential if it is public without breach, independently developed, or
        rightfully received without restriction.
      </p>

      <h2>12. Privacy and data protection</h2>
      <p>
        Our <Link href="/privacy">Privacy Policy</Link> describes our controller activities. For
        Customer Content where we act as processor, the customer is responsible for its instructions
        and lawful basis. Customers needing a data-processing agreement or transfer terms should
        contact <a href={`mailto:${legalContactEmail}`}>{legalContactEmail}</a> before using the
        Service for data that depends on those terms.
      </p>
      <p>
        Our <Link href="/cookies">Cookies and similar technologies notice</Link> lists current
        browser storage and the conditions for any optional public analytics. The notice provides
        information; accepting these Terms does not consent to optional browser analytics.
      </p>
      <p>
        The hosted Service is not approved for special-category personal data, protected health
        information, government identifiers, financial account credentials, or other highly
        regulated data. You must not submit any such data unless Timeline has given express prior
        written approval for the specific data and use case. Our written approval is mandatory in
        every case, even if you have determined that you have a lawful basis and appropriate
        safeguards.
      </p>
      <p>
        Supported complex documents may be processed in an ephemeral Daytona sandbox. Sandbox state
        is discarded when the sandbox stops, while Daytona documents three-day retention for its
        observability logs, traces, and metrics.
      </p>
    </>
  );
}

function TermsProductAndLifecycleSections() {
  return (
    <>
      <h2>13. Our intellectual property</h2>
      <p>
        Except for Customer Content and third-party materials, Timeline and its software, designs,
        documentation, trademarks, and service content belong to us or our licensors. These Terms
        grant only the limited right to use the hosted Service while your account is authorized.
        Public availability of source code does not by itself grant permission to copy, modify,
        redistribute, or self-host it; those rights exist only under an applicable license. Third-
        party and open-source components remain governed by their own licenses.
      </p>

      <h2>14. Feedback and contributions</h2>
      <p>
        If you provide feedback, you grant us a perpetual, worldwide, irrevocable, royalty-free
        right to use it without restriction or compensation, without identifying you publicly.
        Before contributing code or documentation, review the contribution terms and license in the
        relevant repository; if none is published, contact us before submitting the contribution.
      </p>

      <h2>15. Beta features and service changes</h2>
      <p>
        We may identify features as preview, experimental, beta, or evaluation features. They may be
        less reliable, change without notice, and be discontinued. We may improve, replace, add, or
        remove features and supported providers. We will provide reasonable notice when a material
        change substantially reduces core functionality, where practicable.
      </p>

      <h2>16. Suspension and termination</h2>
      <p>
        You may stop using the Service at any time. We may suspend or terminate access when you
        materially breach these Terms, fail to cure a remediable breach after notice, create an
        urgent security or legal risk, or when continued provision is unlawful. We may act without
        advance notice for urgent risk and will explain the reason when legally and practically
        permitted.
      </p>
      <p>
        Before planned termination, use available export tools or contact us. After termination we
        may delete Customer Content from active systems after a reasonable retrieval period, unless
        a written agreement says otherwise or law requires retention. Sections that by nature should
        survive—including ownership, confidentiality, disclaimers, liability, indemnity, and dispute
        terms—remain effective.
      </p>
    </>
  );
}

function TermsRiskSections() {
  return (
    <>
      <h2>17. Disclaimers</h2>
      <p>
        To the maximum extent permitted by law, the Service is provided “as is” and “as available”.
        We disclaim implied warranties of merchantability, fitness for a particular purpose,
        non-infringement, and uninterrupted or error-free operation. We do not warrant that AI
        output or captured source data is accurate, complete, or suitable for a particular decision.
        These disclaimers do not limit warranties or rights that cannot lawfully be excluded.
      </p>

      <h2>18. Limitation of liability</h2>
      <p>
        To the maximum extent permitted by law, neither party will be liable for indirect,
        incidental, special, consequential, exemplary, or punitive damages, or for lost profits,
        revenue, goodwill, business opportunity, or data, even if advised that such loss was
        possible. Timeline&apos;s total liability arising from the Service or these Terms will not
        exceed the greater of the amount paid by you for the Service during the 12 months before the
        event giving rise to the claim or €100.
      </p>
      <p>
        These limits do not apply to liability that cannot legally be limited, or to your payment
        obligations, infringement or misuse of our intellectual property, violation of acceptable
        use, or indemnity obligations. Mandatory consumer rights remain unaffected.
      </p>

      <h2>19. Indemnity</h2>
      <p>
        If you use the Service for an organization, that organization will defend and indemnify
        Timeline and its personnel against third-party claims, damages, and reasonable costs arising
        from Customer Content, unlawful capture or recording, connected services, or your material
        breach of these Terms, except to the extent caused by our breach, negligence, or willful
        misconduct. We will promptly notify you and allow you to control the defense, subject to our
        right to participate and to approve any settlement imposing liability or an admission on us.
      </p>

      <h2>20. Governing law and disputes</h2>
      <p>
        These Terms are governed by Estonian law, without its conflict-of-law rules. The courts of
        Harju County, Estonia have exclusive jurisdiction, except that either party may seek urgent
        injunctive relief in a competent court and mandatory consumer law may provide a different
        forum or governing law. Before filing a claim, the parties will try in good faith for 30
        days to resolve it after written notice.
      </p>
    </>
  );
}

function TermsClosingSections({ legalContactEmail }: { legalContactEmail: LegalContactEmail }) {
  return (
    <>
      <h2>21. Changes to these Terms</h2>
      <p>
        We may update these Terms to reflect product, provider, legal, or security changes. We will
        publish a new version and effective date. For material changes, we will provide reasonable
        notice and require each signed-in user to accept the current Terms before continuing into
        the protected product. Continued use after valid acceptance means the updated Terms apply.
      </p>

      <h2>22. General terms</h2>
      <p>
        You may not assign these Terms without our consent, except as part of a permitted corporate
        reorganization. We may assign them in connection with a merger, acquisition, reorganization,
        or sale of assets. Neither party is liable for delay caused by events beyond reasonable
        control. If a provision is unenforceable, it will be modified only as necessary and the rest
        remains effective. Failure to enforce a provision is not a waiver. These Terms and any
        applicable signed agreement are the complete agreement about the Service and supersede prior
        discussions on that subject.
      </p>

      <h2>23. Contact</h2>
      <p>
        Legal questions and notices: <a href={`mailto:${legalContactEmail}`}>{legalContactEmail}</a>
        . Provider: {LEGAL_PROVIDER}, Estonian registry code {LEGAL_REGISTRY_CODE}, {LEGAL_ADDRESS}.
      </p>
    </>
  );
}

export default function TermsPage() {
  const legalContactEmail = getLegalContactEmail();

  if (!isLegalPublicationReady()) {
    return (
      <LegalPage
        eyebrow="Publication pending"
        title="Terms of Use"
        description="Binding Terms are not currently being published or presented for acceptance."
      >
        <p>
          The Timeline is completing a contracting-entity publication-readiness review. Until that
          review is resolved and evidenced, this page does not form an agreement, no new Terms
          version is in force through this page, and the product will not ask users to accept it.
        </p>
        <p>
          Existing users may continue under any previously applicable agreement. New account
          creation is paused. For questions, email{' '}
          <a href={`mailto:${legalContactEmail}`}>{legalContactEmail}</a>.
        </p>
      </LegalPage>
    );
  }

  return (
    <LegalPage
      eyebrow={`Version ${TERMS_VERSION} · Effective ${LEGAL_EFFECTIVE_DATE}`}
      title="Terms of Use"
      description="The agreement governing access to The Timeline, including team authority, captured content, AI features, acceptable use, and responsibility."
    >
      <TermsFormationSections />
      <TermsContentAndAiSections />
      <TermsResponsibleUseSections legalContactEmail={legalContactEmail} />
      <TermsProductAndLifecycleSections />
      <TermsRiskSections />
      <TermsClosingSections legalContactEmail={legalContactEmail} />
    </LegalPage>
  );
}
