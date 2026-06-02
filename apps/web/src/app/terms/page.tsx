import type { Metadata } from 'next';

import { LegalPage } from '@/components/legal-page';
import {
  LEGAL_ADDRESS,
  LEGAL_EFFECTIVE_DATE,
  LEGAL_PROVIDER,
  LEGAL_SERVICE_URL,
  TERMS_VERSION,
  getLegalContactEmail,
} from '@/lib/legal-versions';
import { publicMetadata } from '@/lib/public-metadata';

export const metadata: Metadata = publicMetadata({
  title: 'Terms of Use',
  description: 'Terms of Use for The Timeline.',
  path: '/terms',
});

export const dynamic = 'force-dynamic';

export default function TermsPage() {
  const legalContactEmail = getLegalContactEmail();

  return (
    <LegalPage
      eyebrow={`Version ${TERMS_VERSION} · Effective ${LEGAL_EFFECTIVE_DATE}`}
      title="Terms of Use"
      description="These terms govern access to The Timeline, a team memory product operated by Nyxone OÜ."
    >
      <p>
        These Terms of Use are an agreement between you and {LEGAL_PROVIDER} (“we”, “us”, or “our”)
        for the use of The Timeline at {LEGAL_SERVICE_URL} and related services.
      </p>

      <h2>1. The Service</h2>
      <p>
        The Timeline is a team memory product. Team members can capture, import, search, summarize,
        and organize information from capture surfaces such as web forms, Telegram, Slack, email,
        documents, meetings, calendars, third-party integrations, and connected MCP servers.
      </p>

      <h2>2. Accounts and Teams</h2>
      <p>
        You are responsible for keeping your account credentials secure and for activity performed
        through your account. Teams are shared workspaces. Owners and admins are responsible for
        inviting appropriate team members, managing team settings, and configuring shared capture
        surfaces lawfully.
      </p>

      <h2>3. Legal Acceptance</h2>
      <p>
        You must accept the current Terms of Use and acknowledge the current Privacy Policy before
        entering the signed-in product. We may require a new acceptance when we publish updated
        versions.
      </p>

      <h2>4. Customer Content and Capture Responsibility</h2>
      <p>
        You and your team retain responsibility for content submitted to The Timeline, including raw
        events, messages, transcripts, documents, files, calendar data, integration data, and
        prompts. You must have the rights and permissions needed to submit, import, record,
        transcribe, process, share, and store that content.
      </p>
      <p>
        Where a capture surface includes third-party content, conversations, meetings, calls,
        messages, or documents, you are responsible for providing notices and obtaining consents
        required by law, contract, workplace policy, or platform policy. Meeting bots and
        transcription features must only be used when participants have been appropriately informed.
      </p>

      <h2>5. Privacy and Visibility Settings</h2>
      <p>
        The Timeline includes team, private, and specific-user visibility controls. You are
        responsible for choosing appropriate visibility settings for the content you submit or
        configure. Owners and admins do not receive a general right to access another member&apos;s
        private items.
      </p>

      <h2>6. AI Features</h2>
      <p>
        The Timeline uses AI features for transcription, extraction, summarization, embeddings,
        suggestions, and agent answers. AI outputs may be inaccurate, incomplete, delayed, or based
        on incomplete source material. You are responsible for reviewing outputs and verifying them
        against cited raw events before relying on them.
      </p>
      <p>
        The Timeline is not a provider of legal, financial, medical, employment, safety, or other
        professional advice. Do not rely on AI outputs for consequential decisions without
        independent human review and appropriate professional judgment.
      </p>

      <h2>7. Acceptable Use</h2>
      <p>
        You may not use The Timeline to violate law, infringe rights, compromise security, upload
        malicious code, abuse infrastructure, scrape or probe the service without permission, bypass
        access controls, or submit content you do not have the right to process through the service.
      </p>

      <h2>8. Third-Party Services</h2>
      <p>
        The Timeline can connect to third-party services. Those services are governed by their own
        terms and privacy policies. You are responsible for the third-party accounts, workspaces,
        permissions, and content you connect to The Timeline.
      </p>

      <h2>9. Availability and Changes</h2>
      <p>
        We may change, suspend, or discontinue parts of the service. We try to operate The Timeline
        carefully, but the service is provided without a guarantee that it will be uninterrupted,
        error-free, or fit for a particular purpose.
      </p>

      <h2>10. Termination</h2>
      <p>
        You may stop using The Timeline at any time. We may suspend or terminate access if you
        breach these terms, create security or legal risk, or use the service in a way that harms
        other users, third parties, or the service.
      </p>

      <h2>11. Liability</h2>
      <p>
        To the maximum extent permitted by law, The Timeline is provided “as is”, and{' '}
        {LEGAL_PROVIDER} will not be liable for indirect, incidental, special, consequential,
        exemplary, or punitive damages, or for lost profits, revenues, data, goodwill, or business
        opportunities.
      </p>

      <h2>12. Governing Law</h2>
      <p>
        These terms are governed by the laws of Estonia, without regard to conflict-of-law rules.
        Courts in Estonia will have jurisdiction unless mandatory law requires otherwise.
      </p>

      <h2>13. Contact</h2>
      <p>
        Contact:{' '}
        {legalContactEmail ? (
          <a href={`mailto:${legalContactEmail}`}>{legalContactEmail}</a>
        ) : (
          'support email not configured'
        )}
        . Provider: {LEGAL_PROVIDER}, {LEGAL_ADDRESS}.
      </p>
    </LegalPage>
  );
}
