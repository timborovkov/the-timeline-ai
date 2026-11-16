import { CAPACITY_BY_PLAN, PLAN_CATALOG, formatStorageGb } from '@timeline/shared/billing/catalog';

import { TRUST_AI_PRIVACY_SUMMARY } from '@/lib/trust-claims';

const free = PLAN_CATALOG.free;
const freeCapacity = CAPACITY_BY_PLAN.free;

export const PRICING_FAQS = [
  {
    question: 'What happens on the free plan?',
    answer: `The ${free.name} plan is ${free.tagline.charAt(0).toLowerCase()}${free.tagline.slice(1)} The platform fee is €0, with a €0 spend cap that hard-stops metered usage. Included capacity is ${freeCapacity.agentTurnsPerMonth} Ask turns, ${freeCapacity.acceptedSourcesPerMonth?.toLocaleString('en-IE')} accepted sources (timeline.remember notes count toward that meter, like other ingest evidence), ${freeCapacity.recallMinutesPerMonth} meeting minutes, ${freeCapacity.inboundEmailPerMonth} inbound emails, ${freeCapacity.documents?.toLocaleString('en-IE')} documents, ${freeCapacity.indexedChunks?.toLocaleString('en-IE')} indexed chunks and ${formatStorageGb(freeCapacity.storageGb ?? 0)} of file storage per month. Custom MCP servers are not included. Support is ${free.supportLabel.toLowerCase()}.`,
  },
  {
    question: 'What changes when I add payment?',
    answer: `Pay as you go keeps the included Free allowances, with no platform fee. Usage beyond those allowances is charged at the published rates. ${PLAN_CATALOG.payg.includedActiveMembers} active members are included; extra members cost €${(PLAN_CATALOG.payg.additionalMemberCents ?? 0) / 100} per member per month. Team and Business have a monthly platform fee and a pooled usage credit instead.`,
  },
  {
    question: 'Does the spending limit cap my whole bill?',
    answer:
      'No. It limits metered spend; platform fees and tax are outside it. On Team and Business, the cap is checked before included usage credit. Separate capacity limits can pause an action even when you have spending room. Owners and admins can change the spend cap in Billing.',
  },
  {
    question: 'How do I cancel or change payment details?',
    answer:
      'Open Manage payment in Billing to use the payment provider’s customer portal. Check its confirmation for the effective cancellation date and outstanding charges, then verify the updated subscription state in Billing. Disconnecting a source or deleting individual data does not cancel billing. Contact support if the portal does not offer the action you need.',
  },
  {
    question: 'Do I need a CRM or ticket board?',
    answer:
      'Just starting out, you may not need one. The Timeline keeps people, company, deal, task and decision records current from Slack or Telegram, email and calls. You can add a CRM or ticket board later if you want one.',
  },
  {
    question: 'I already use HubSpot / Jira / Linear.',
    answer:
      'Keep them. Linear already syncs selected issues into The Timeline. Jira can be looked up live through Atlassian MCP. HubSpot, Attio and Pipedrive native ingest is coming soon. Timeline does not replace those tools or sync HubSpot today.',
  },
  {
    question: 'How is my data used?',
    answer: `${TRUST_AI_PRIVACY_SUMMARY} Team scope and per-event visibility apply to stored work. See Privacy and Trust for the full policy, subprocessors, and human-access rules.`,
  },
] as const;
