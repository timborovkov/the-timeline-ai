import { ArrowDown, Check, Link2 } from 'lucide-react';

import type { UseCaseContent } from '@/components/marketing/use-cases/content';

import styles from '@/components/marketing/use-cases/use-case-preview.module.css';

const previews = {
  'work-record': {
    title: 'Acme rollout',
    label: 'One project. The work behind it.',
    rows: [
      ['Mon · Telegram', 'Customer update promised'],
      ['Mon · Slack', 'Onboarding copy approved'],
      ['Tue · Meeting', 'SSO named as the blocker'],
      ['Wed · GitHub', 'Migration callback merged'],
    ],
  },
  'team-daily-log': {
    title: 'Your team’s daily update',
    label: 'What changed. What needs attention.',
    rows: [
      ['Shipped', 'Migration callback merged'],
      ['Decided', 'Onboarding copy approved'],
      ['Blocked', 'SSO validation before launch'],
    ],
  },
  'communication-trail': {
    title: 'An update by the 14th.',
    label: 'A promise, with its history attached.',
    rows: [
      ['Telegram · Launch group', 'The customer update was promised.'],
      ['Meeting · Launch review', 'SSO is still blocking launch.'],
      ['Document · Checklist', 'Priya owns the review.'],
    ],
  },
  crm: {
    title: 'A customer, in context.',
    label: 'People, commitments and open questions.',
    rows: [
      ['Stakeholder', 'Maya Chen · Technical evaluation'],
      ['Interest', 'Two-region expansion option'],
      ['Next commitment', 'Security answers before the review'],
      ['Still unknown', 'Budget authority and purchase timing'],
    ],
  },
  'task-board': {
    title: 'Migration checklist',
    label: 'A conversation becomes a proposed task.',
    rows: [
      ['Owner', 'Priya Shah'],
      ['Due', 'The 14th'],
      ['Source', 'Slack · #acme-rollout'],
    ],
  },
  'onboarding-and-repeat-questions': {
    title: 'The handoff starts here.',
    label: 'Acme rollout · A new owner joins.',
    rows: [
      ['Current state', 'Launch waiting on SSO validation.'],
      ['Commitment', 'A customer update is still due.'],
      ['Next owner', 'Priya owns the migration checklist.'],
      ['Sources', 'Launch group, review meeting and checklist.'],
    ],
  },
} as const;

export function UseCasePreview({ useCase }: { useCase: UseCaseContent }) {
  const preview = previews[useCase.slug];
  return (
    <figure className={styles.preview} data-preview-kind={useCase.slug}>
      <h2>{preview.title}</h2>
      <div className={styles.heading}>
        <span className={styles.mark} aria-hidden="true">
          <Link2 size={20} />
        </span>
        <p>{preview.label}</p>
      </div>
      {useCase.slug === 'task-board' ? (
        <blockquote>“Priya will own the migration checklist. Review on the 14th.”</blockquote>
      ) : null}
      <dl className={styles.rows}>
        {preview.rows.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <div className={styles.foot}>
        {useCase.slug === 'task-board' || useCase.slug === 'crm' ? (
          <>
            <ArrowDown size={16} aria-hidden="true" /> Proposed changes wait for your approval
          </>
        ) : (
          <>
            <Check size={16} aria-hidden="true" /> Sources stay attached
          </>
        )}
      </div>
      <figcaption>Illustrative example · {useCase.navLabel}</figcaption>
    </figure>
  );
}
