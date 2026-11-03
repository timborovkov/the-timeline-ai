import { CAPACITY_BY_PLAN, PLAN_CATALOG } from '@timeline/shared/billing/catalog';

import { TRUST_AI_PRIVACY_SUMMARY } from '@/lib/trust-claims';

const free = PLAN_CATALOG.free;
const freeCapacity = CAPACITY_BY_PLAN.free;

export const PRICING_FAQS = [
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
  {
    question: 'What happens on the free plan?',
    answer: `The ${free.name} plan is ${free.tagline.charAt(0).toLowerCase()}${free.tagline.slice(1)} The platform fee is €0, with a €0 spend cap that hard-stops metered usage. Included capacity is ${freeCapacity.agentTurnsPerMonth} Ask turns, ${freeCapacity.acceptedSourcesPerMonth?.toLocaleString('en-IE')} accepted sources, ${freeCapacity.recallMinutesPerMonth} meeting minutes, ${freeCapacity.inboundEmailPerMonth} inbound emails, ${freeCapacity.documents} documents and ${freeCapacity.storageGb} GB of file storage per month. Custom MCP servers are not included. Support is ${free.supportLabel.toLowerCase()}.`,
  },
] as const;
