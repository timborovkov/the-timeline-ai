import type { Metadata } from 'next';

import { LegalPage } from '@/components/legal-page';
import {
  LEGAL_ADDRESS,
  LEGAL_CONTACT_EMAIL,
  LEGAL_EFFECTIVE_DATE,
  LEGAL_PROVIDER,
  PRIVACY_VERSION,
} from '@/lib/legal-versions';

export const metadata: Metadata = {
  title: 'Privacy Policy',
  description: 'Privacy Policy for The Timeline.',
  alternates: { canonical: '/privacy' },
};

export default function PrivacyPage() {
  return (
    <LegalPage
      eyebrow={`Version ${PRIVACY_VERSION} · Effective ${LEGAL_EFFECTIVE_DATE}`}
      title="Privacy Policy"
      description="This policy explains how The Timeline processes personal data for team memory, capture, search, and AI-assisted workflows."
    >
      <p>
        This Privacy Policy describes how {LEGAL_PROVIDER} (“we”, “us”, or “our”) processes personal
        data when you use The Timeline.
      </p>

      <h2>1. Controller</h2>
      <p>
        For account, billing, product, support, and website data, the controller is {LEGAL_PROVIDER}
        , {LEGAL_ADDRESS}. Contact us at{' '}
        <a href={`mailto:${LEGAL_CONTACT_EMAIL}`}>{LEGAL_CONTACT_EMAIL}</a>.
      </p>
      <p>
        For team content submitted to a workspace, the team or organization using The Timeline may
        be the controller, and we may act as a processor according to that team&apos;s instructions.
      </p>

      <h2>2. Data We Process</h2>
      <ul>
        <li>
          Account data, such as name, email address, authentication provider, and profile image.
        </li>
        <li>Team data, such as memberships, roles, invitations, settings, and audit records.</li>
        <li>
          Customer content, such as raw events, messages, transcripts, documents, files, calendar
          events, integration events, prompts, extracted facts, objects, suggestions, and agent
          answers.
        </li>
        <li>Support data submitted through public or signed-in support forms.</li>
        <li>
          Technical data, such as IP address, request metadata, logs, diagnostics, and abuse
          signals.
        </li>
      </ul>

      <h2>3. How We Use Data</h2>
      <ul>
        <li>Provide, secure, maintain, debug, and improve The Timeline.</li>
        <li>Authenticate users and manage teams, invitations, roles, and settings.</li>
        <li>Capture, transcribe, extract, embed, search, summarize, and display team content.</li>
        <li>Generate citations, suggestions, notifications, and agent answers.</li>
        <li>Respond to support, billing, security, and legal requests.</li>
        <li>Prevent abuse, enforce terms, and protect users, teams, and the service.</li>
      </ul>

      <h2>4. AI Processing</h2>
      <p>
        The Timeline sends relevant content to model providers or model-routing services to support
        features such as transcription, embeddings, extraction, summarization, and agent answers. AI
        outputs can be inaccurate or incomplete and should be verified against cited source
        material.
      </p>

      <h2>5. Core Sub-Processors</h2>
      <p>We use service providers to operate The Timeline. Current core sub-processors include:</p>
      <table>
        <thead>
          <tr>
            <th>Provider</th>
            <th>Purpose</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>OpenRouter / OpenAI-compatible model providers</td>
            <td>
              Model routing, chat, embeddings, transcription, extraction, and related AI features.
            </td>
          </tr>
          <tr>
            <td>Recall.ai</td>
            <td>
              Meeting bot attendance and transcript capture when meeting features are enabled.
            </td>
          </tr>
          <tr>
            <td>Railway / Postgres hosting</td>
            <td>Application hosting and relational database infrastructure.</td>
          </tr>
          <tr>
            <td>Qdrant</td>
            <td>Vector search and retrieval indexes.</td>
          </tr>
          <tr>
            <td>RustFS / S3-compatible object storage</td>
            <td>Document, file, and object storage.</td>
          </tr>
          <tr>
            <td>Postmark</td>
            <td>Transactional email, inbound email, invites, and support mail.</td>
          </tr>
          <tr>
            <td>Sentry, if enabled</td>
            <td>Error reporting and diagnostics.</td>
          </tr>
          <tr>
            <td>Cloudflare Turnstile</td>
            <td>Abuse prevention on public forms and email/password signup.</td>
          </tr>
        </tbody>
      </table>

      <h2>6. Optional User-Enabled Integrations</h2>
      <p>
        Teams may choose to connect external services such as Slack, Telegram, GitHub, Google Drive,
        Linear, calendar providers, and custom MCP servers. When enabled, The Timeline processes
        data from those services according to the permissions granted by the user or team.
      </p>

      <h2>7. Cookies</h2>
      <p>
        We use essential cookies and similar technologies for authentication, sessions, security,
        team selection, invite handling, preferences, and abuse prevention. We do not use a separate
        cookie consent flow for non-essential advertising cookies in the current product.
      </p>

      <h2>8. Retention</h2>
      <p>
        We retain account data while your account is active, team content while the team keeps it in
        The Timeline, and operational logs for security, debugging, compliance, and abuse
        prevention. Raw events are designed as immutable source evidence unless hidden through
        supported product workflows such as source deletion tombstones.
      </p>

      <h2>9. Security</h2>
      <p>
        We use technical and organizational measures designed to protect data, including encrypted
        transport, access controls, team isolation, visibility controls, encrypted integration
        secrets, and security-relevant audit logs. No system can be guaranteed completely secure.
      </p>

      <h2>10. International Transfers</h2>
      <p>
        We and our providers may process data in countries outside your location. Where required, we
        use appropriate safeguards for international transfers.
      </p>

      <h2>11. Your Rights</h2>
      <p>
        Depending on your location, you may have rights to access, correct, delete, export,
        restrict, or object to processing of personal data. Contact us to exercise these rights. If
        your data belongs to a team workspace controlled by your organization, we may direct your
        request to that organization.
      </p>

      <h2>12. Changes</h2>
      <p>
        We may update this Privacy Policy. If changes require renewed acknowledgement, The Timeline
        will ask signed-in users to accept or acknowledge the updated versions before entering the
        signed-in product.
      </p>

      <h2>13. Contact</h2>
      <p>
        Contact: <a href={`mailto:${LEGAL_CONTACT_EMAIL}`}>{LEGAL_CONTACT_EMAIL}</a>. Provider:{' '}
        {LEGAL_PROVIDER}, {LEGAL_ADDRESS}.
      </p>
    </LegalPage>
  );
}
