import Link from 'next/link';

import { buildEnterpriseEnquiryHref } from '@/lib/enterprise-enquiry';
import {
  GITHUB_LICENSE_URL,
  GITHUB_REPOSITORY_URL,
  GITHUB_SELF_HOSTING_URL,
} from '@/lib/support-links';
import { cn } from '@/lib/utils';

const ON_PREM_ENQUIRY_HREF = buildEnterpriseEnquiryHref({
  from: 'pricing',
  selectedTopics: ['on_premise_deployment'],
});

/** Quiet gray enterprise contact line — not a fifth plan column. */
export function PricingEnterpriseNudge({ className }: { className?: string }) {
  return (
    <div
      data-pricing-enterprise-nudge
      className={cn('space-y-2 py-3 text-sm leading-6 text-fg-muted', className)}
    >
      <p>
        Need governance, procurement, committed volume, an SLA, or a managed on-premise /
        private-cloud deployment?{' '}
        <Link
          href={ON_PREM_ENQUIRY_HREF}
          data-public-analytics-cta="contact_enterprise"
          className="text-fg-muted underline decoration-border underline-offset-4 hover:text-fg"
        >
          Contact us for Enterprise
        </Link>
        .
      </p>
      <p>
        Or deploy it yourself from the{' '}
        <a
          href={GITHUB_REPOSITORY_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="underline decoration-border underline-offset-4 hover:text-fg"
        >
          public GitHub repository
        </a>{' '}
        (source-available under the{' '}
        <a
          href={GITHUB_LICENSE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="underline decoration-border underline-offset-4 hover:text-fg"
        >
          Elastic License 2.0
        </a>
        ). See{' '}
        <a
          href={GITHUB_SELF_HOSTING_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="underline decoration-border underline-offset-4 hover:text-fg"
        >
          self-hosting
        </a>
        .
      </p>
    </div>
  );
}
