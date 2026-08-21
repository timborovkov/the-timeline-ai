import type { PublicCanonicalPath } from '@/lib/public-site';

export const SOLUTION_ROUTES = {
  clientProjectHandoffs: '/solutions/client-project-handoffs',
  weeklyProjectUpdates: '/solutions/weekly-project-updates',
  crmContextFromTeamActivity: '/solutions/crm-context-from-team-activity',
} as const satisfies Record<string, `/solutions/${string}`>;

export type SolutionRoute = (typeof SOLUTION_ROUTES)[keyof typeof SOLUTION_ROUTES];
type SolutionSlug = SolutionRoute extends `/solutions/${infer Slug}` ? Slug : never;

interface SolutionWorkflowStep {
  index: string;
  title: string;
  body: string;
  output: string;
}

interface SolutionEvidenceRole {
  label: string;
  role: string;
  includes: string;
  boundary: string;
  href?: PublicCanonicalPath;
}

interface SolutionFaq {
  question: string;
  answer: string;
}

export interface SolutionContent {
  slug: SolutionSlug;
  route: SolutionRoute;
  seoTitle: string;
  seoDescription: string;
  shortTitle: string;
  audienceLabel: string;
  eyebrow: string;
  title: string;
  summary: string;
  answer: {
    title: string;
    body: string;
    checklist: readonly string[];
  };
  context: readonly string[];
  workflow: readonly SolutionWorkflowStep[];
  evidenceRoles: readonly SolutionEvidenceRole[];
  questions: readonly string[];
  example: {
    label: string;
    title: string;
    body: string;
    claims: readonly string[];
    note: string;
  };
  limitations: readonly string[];
  faqs: readonly SolutionFaq[];
  relatedRoutes: readonly SolutionRoute[];
  furtherReading?: { label: string; href: PublicCanonicalPath };
  cta: {
    title: string;
    body: string;
    label: string;
    href: '/sign-up';
  };
}

export const SOLUTIONS: readonly SolutionContent[] = [
  {
    slug: 'client-project-handoffs',
    route: SOLUTION_ROUTES.clientProjectHandoffs,
    seoTitle: 'Client Project Handoffs With Evidence',
    seoDescription:
      'Turn selected chats, meetings, emails, documents, tasks, and code into a current handoff with cited decisions, blockers, owners, and commitments.',
    shortTitle: 'Client project handoffs',
    audienceLabel: 'Consulting and client delivery',
    eyebrow: 'Solution · Client delivery',
    title: 'Hand off the whole project, not a reconstruction.',
    summary:
      'Timeline turns selected project work into a chronological history, so the next owner can see what changed, why it changed, and which source supports each claim.',
    answer: {
      title: 'Build the handoff from the evidence the project already produced.',
      body: 'Choose the conversations, meetings, email, documents, tasks, and code records that belong to the engagement. Timeline preserves them as separate, time-addressable evidence and can answer a bounded handoff question with citations. A person still reviews the result before it is shared or used to change the workspace.',
      checklist: [
        'Decisions, including the source and the reasoning that survived',
        'Open blockers and unresolved questions instead of invented certainty',
        'Named owners, commitments, dates, and the evidence behind them',
        'A citation path the incoming owner can inspect before acting',
      ],
    },
    context: [
      'A project handoff usually fails in the gaps between systems. The delivery plan may live in a document, the exception in a meeting, the promise in email, and the latest implementation state in a task or pull request. A summary written from memory quietly drops those boundaries.',
      'Timeline is an AI team memory for the evidence a team deliberately preserves. It orders selected work by time without pretending every source has equal authority. The handoff can therefore state what is known, show where it came from, and leave conflicts visible for the incoming owner.',
    ],
    workflow: [
      {
        index: '01',
        title: 'Set one project boundary',
        body: 'Name the engagement, its time window, and the exact channels, meetings, files, mail, task projects, or repositories that contain the work. Do not start with an all-company search.',
        output: 'A finite evidence set tied to one client project.',
      },
      {
        index: '02',
        title: 'Preserve the chronology',
        body: 'Captured records stay separate and time-addressable. A proposal in chat, a later document revision, and a completed task can be read in sequence without being flattened into one undifferentiated note.',
        output: 'A project history that retains source, time, and visibility.',
      },
      {
        index: '03',
        title: 'Ask for a handoff with edges',
        body: 'Request decisions, current state, blockers, commitments, owners, and missing evidence. Ask Timeline to cite factual claims and surface disagreement rather than resolving it silently.',
        output: 'A reviewable handoff draft with cited claims and explicit gaps.',
      },
      {
        index: '04',
        title: 'Review before transfer',
        body: 'Open consequential citations, confirm authority, and correct anything the evidence cannot establish. Durable object or task changes remain proposals until a person approves them.',
        output: 'A human-approved handoff the next owner can verify.',
      },
    ],
    evidenceRoles: [
      {
        label: 'Chats and email',
        role: 'Decision trail and commitments',
        includes:
          'Messages from linked Telegram groups, selected Slack conversations, and inbound email preserved for the project.',
        boundary:
          'A connected account is not the same as a complete project history. Only successfully captured, visibility-eligible evidence can support an answer.',
        href: '/integrations',
      },
      {
        label: 'Meetings and documents',
        role: 'Discussion, briefs, and approved artifacts',
        includes:
          'Consent-gated meeting transcripts, uploaded documents, and supported Google Drive files captured inside activated sources.',
        boundary:
          'A transcript records what was said, not whether a commitment was later completed. Drive coverage begins within the documented activation boundary.',
        href: '/integrations/google-drive',
      },
      {
        label: 'Tasks and code',
        role: 'Planned and implemented work',
        includes:
          'Linear issue state from selected teams plus GitHub pull requests, reviews, commits, workflow runs, and releases captured by native integrations.',
        boundary:
          'A closed Linear issue, merged pull request, or published release does not by itself prove deployment or a client outcome. Treat planning, implementation, release publication, deployment, and impact as separate claims.',
        href: '/integrations/github',
      },
    ],
    questions: [
      'What decisions changed this project, who agreed to them, and which source is current?',
      'What remains blocked, who owns each next step, and what evidence is missing?',
      'Which commitments were made to the client this month, and were any revised later?',
      'Prepare a handoff for the incoming owner, separating fact, conflict, and inference.',
    ],
    example: {
      label: 'Illustrative handoff',
      title: 'Northstar rollout is ready for transfer, with two open edges.',
      body: 'The handoff can lead with the current state, then keep each consequential statement tied to its evidence instead of hiding the source trail in an appendix.',
      claims: [
        'Scope: the approved pilot remains limited to two regions [brief v4]',
        'Decision: the launch moved to 18 September after the security review [meeting, 14 Aug]',
        'Open edge: production access still has no confirmed owner [Slack thread, 19 Aug]',
        'Implementation: the import fix was merged; release evidence is still missing [GitHub PR #418]',
      ],
      note: 'Fictional example. Citations show what captured sources support; they do not replace delivery review.',
    },
    limitations: [
      'Timeline cannot cite work that was never selected, sent, or successfully captured.',
      'A citation proves what a captured source contains, not that the real-world action happened.',
      'Later evidence is not automatically more authoritative than an approved document or signed decision.',
      'Private or restricted evidence remains excluded for people who cannot retrieve it.',
      'The handoff is a reviewable draft; consequential claims and durable changes still need a person.',
    ],
    faqs: [
      {
        question: 'Does Timeline replace the human handoff review?',
        answer:
          'No. Timeline can assemble a cited draft from selected evidence and expose gaps or conflicts. The outgoing owner still verifies consequential claims and decides what is authoritative before transfer.',
      },
      {
        question: 'What happens when two sources disagree?',
        answer:
          'The useful answer names the conflict and cites both sources. Timeline should not silently decide whether a later chat message overrides an approved brief, contract, or other authoritative record.',
      },
      {
        question: 'Can a handoff include private project context?',
        answer:
          'Only when the person reading the answer is allowed to retrieve that evidence. Timeline applies team and per-event visibility rules when searching and answering.',
      },
    ],
    relatedRoutes: [
      SOLUTION_ROUTES.weeklyProjectUpdates,
      SOLUTION_ROUTES.crmContextFromTeamActivity,
    ],
    furtherReading: { label: 'See how selected work becomes cited history', href: '/how-it-works' },
    cta: {
      title: 'Test one real handoff.',
      body: 'Choose one project, preserve only its relevant sources, and ask the question the next owner actually needs answered.',
      label: 'Try one project',
      href: '/sign-up',
    },
  },
  {
    slug: 'weekly-project-updates',
    route: SOLUTION_ROUTES.weeklyProjectUpdates,
    seoTitle: 'Weekly Project Updates With Source Citations',
    seoDescription:
      'Build weekly project updates from selected Slack, Linear, and GitHub evidence. Separate decisions, blockers, merged work, and releases with citations.',
    shortTitle: 'Weekly project updates',
    audienceLabel: 'Product and engineering teams',
    eyebrow: 'Solution · Project reporting',
    title: 'Build the weekly update from the work itself.',
    summary:
      'Timeline preserves selected Slack, Linear, and GitHub records as a chronological project history, then answers status questions with citations instead of asking everyone to reconstruct the week.',
    answer: {
      title: 'Report discussion, plan, implementation, and release as separate facts.',
      body: 'Activate the Slack channels, Linear teams, and GitHub repositories that contain one project. Ask for a fixed weekly window and a defined update format. Timeline can assemble a cited draft while keeping a discussed decision, a completed issue, a merged change, and a published release distinct.',
      checklist: [
        'What changed during a named weekly window',
        'Decisions and blockers with the conversations that explain them',
        'Issue state, merged work, and releases reported as different evidence',
        'Missing or conflicting signals called out for human review',
      ],
    },
    context: [
      'Weekly updates are expensive when every team member has to remember the same week in a different format. Chat explains why priorities changed, the tracker shows planned state, and the repository shows implementation. None of those sources alone is a complete status report.',
      'Timeline keeps selected provider records in time order and lets a team ask one bounded question across them. The result is useful when it preserves the distinction between discussion, intention, merge, release, and outcome instead of compressing all activity into “done.”',
    ],
    workflow: [
      {
        index: '01',
        title: 'Choose the reporting boundary',
        body: 'Start with one project, one timezone, and one weekly window. Activate only the Slack channels, Linear teams, and GitHub repositories needed for that update.',
        output: 'A repeatable source and time boundary for each reporting cycle.',
      },
      {
        index: '02',
        title: 'Let each system keep its role',
        body: 'Use Slack for discussion and decision context, Linear for planned work and issue state, and GitHub for implementation and release records. Do not treat one signal as proof of another.',
        output: 'A chronology whose evidence types stay explicit.',
      },
      {
        index: '03',
        title: 'Ask for the same update shape',
        body: 'Request decisions, merged work, published releases, blockers, ownership, and next steps. Require citations for factual claims and ask the answer to mark gaps rather than fill them with inference.',
        output: 'A consistent weekly draft that can be compared and checked.',
      },
      {
        index: '04',
        title: 'Verify before publishing',
        body: 'Open the sources behind consequential statements. Confirm whether a merge was released and whether a closed issue produced the claimed outcome before distributing the update.',
        output: 'A reviewed status update with defensible wording.',
      },
    ],
    evidenceRoles: [
      {
        label: 'Slack',
        role: 'Discussion, decisions, and blockers',
        includes:
          'Messages, threads, edits, reactions, and shared-file signals from channels selected and activated for Timeline capture.',
        boundary:
          'Selected-channel coverage and Timeline visibility define what can be retrieved. A Slack connection does not make every workspace conversation available.',
        href: '/integrations/slack',
      },
      {
        label: 'Linear',
        role: 'Planned work and issue state',
        includes:
          'Issues and comments from activated teams, including captured title, description, status, priority, assignee, and project association.',
        boundary:
          'Only teams are activated; project records and associations are captured within those teams, not selected as separate sources. A completed issue does not prove deployment, customer outcome, or a decision.',
        href: '/integrations/linear',
      },
      {
        label: 'GitHub',
        role: 'Implementation and release evidence',
        includes:
          'Pull requests, reviews, commits, workflow runs, and releases—including release tag names—from selected repositories.',
        boundary:
          'A merged pull request is implementation evidence. Captured releases, including tag names, can support release publication; they do not establish deployment. Deployment and environment records are not ingested.',
        href: '/integrations/github',
      },
    ],
    questions: [
      'What changed on Project Northstar from Monday through Friday? Separate decisions, merged work, releases, and unresolved blockers.',
      'Which Linear issues moved, what GitHub evidence supports their implementation, and what remains unverified?',
      'What did the team decide in Slack that changed this week’s plan?',
      'Draft the weekly update with citations and label every claim that still needs an owner to confirm it.',
    ],
    example: {
      label: 'Illustrative weekly update',
      title: 'Checkout recovery moved forward; rollout evidence is still incomplete.',
      body: 'The update can distinguish what the team discussed, what the tracker says, and what the repository proves instead of collapsing all three into a single progress percentage.',
      claims: [
        'Decision: keep failed sends in the recovery queue [Slack, Tue 10:18]',
        'Plan: retry telemetry moved to In progress [Linear AUD-284]',
        'Implementation: persistence fallback merged [GitHub PR #912]',
        'Gap: no captured release record supports production rollout yet',
      ],
      note: 'Fictional example. An update remains a draft until a person checks consequential claims and missing evidence.',
    },
    limitations: [
      'Timeline only reports records inside activated sources and the requested time window.',
      'Slack discussion, Linear completion, GitHub merge, release, and business outcome are different claims.',
      'Connector sync can lag, and missing evidence should stay visible instead of being guessed.',
      'Visibility rules can produce different evidence sets for different readers.',
      'Timeline does not make an unreviewed weekly draft safe to publish automatically.',
    ],
    faqs: [
      {
        question: 'Does a completed Linear issue count as shipped?',
        answer:
          'Not by itself. It proves the captured tracker state. Implementation needs captured code evidence, and release publication needs a captured release. Deployment needs explicit evidence from another captured source because the GitHub connector does not ingest deployments.',
      },
      {
        question: 'Can Timeline write the update on a schedule?',
        answer:
          'This page describes building a cited update from a bounded weekly window. It does not promise autonomous publication. A person should review the evidence and wording before the update is shared.',
      },
      {
        question: 'What if a project spans several channels and repositories?',
        answer:
          'Activate the specific sources that belong to the project and name the stable project identifiers in the question. Broader coverage can help, but it also increases ambiguity and review work.',
      },
    ],
    relatedRoutes: [
      SOLUTION_ROUTES.clientProjectHandoffs,
      SOLUTION_ROUTES.crmContextFromTeamActivity,
    ],
    furtherReading: {
      label: 'Read the Slack, Linear, and GitHub walkthrough',
      href: '/guides/weekly-engineering-updates-from-slack-linear-and-github',
    },
    cta: {
      title: 'Test one reporting cycle.',
      body: 'Pick one project and one week. Ask for the status update, then inspect whether every consequential claim has the right source.',
      label: 'Try one project',
      href: '/sign-up',
    },
  },
  {
    slug: 'crm-context-from-team-activity',
    route: SOLUTION_ROUTES.crmContextFromTeamActivity,
    seoTitle: 'CRM Context From Team Activity',
    seoDescription:
      'Turn selected messages, meetings, email, and documents into cited people, company, deal, and follow-up context. Approve durable changes before they land.',
    shortTitle: 'CRM context from team activity',
    audienceLabel: 'Sales, success, and account teams',
    eyebrow: 'Solution · Account context',
    title: 'Keep account context close to the conversation that created it.',
    summary:
      'Timeline turns selected customer work into cited people, company, deal, and follow-up context, while a person stays in control of durable changes.',
    answer: {
      title:
        'Use team activity as evidence for CRM-like context, not as permission to rewrite records.',
      body: 'Deliberately preserve the messages, meetings, email, and documents that contain an account’s history. Timeline can answer questions across that chronology and connect evidence to people, company, deal, project, or task objects. Suggested durable changes remain reviewable proposals until a person approves, edits, or rejects them.',
      checklist: [
        'Account decisions and commitments tied to their original conversation',
        'People, company, deal, project, and follow-up context kept distinct',
        'Conflicts and missing evidence surfaced instead of silently normalized',
        'Human approval before suggested object or task changes land',
      ],
    },
    context: [
      'CRM context decays when the customer record depends on someone remembering to translate every call, email, and internal discussion into fields. The opposite failure is an agent that updates durable records from weak signals without showing its evidence.',
      'Timeline takes a narrower path. It preserves selected team activity as chronological evidence, answers account questions with citations, and can propose structured context. The source record remains inspectable, visibility still applies, and a human controls suggested durable workspace changes.',
    ],
    workflow: [
      {
        index: '01',
        title: 'Choose the account evidence',
        body: 'Name the company, deal, or client project and deliberately preserve the conversations, meetings, email, and documents that contain its relevant history.',
        output: 'An explicit account boundary rather than indiscriminate company-wide capture.',
      },
      {
        index: '02',
        title: 'Build the chronological context',
        body: 'Keep a customer promise, an internal qualification note, a revised document, and a later follow-up as distinct events. Timeline can associate evidence with objects without erasing source or time.',
        output: 'A cited account history that remains inspectable.',
      },
      {
        index: '03',
        title: 'Ask the commercial question',
        body: 'Request current stakeholders, commitments, objections, next steps, and unresolved evidence. Ask for citations and require the answer to separate direct statements from inference.',
        output: 'A bounded answer for account review, preparation, or handoff.',
      },
      {
        index: '04',
        title: 'Approve durable changes',
        body: 'Review proposed people, company, deal, project, or task context. Approve, edit, or reject changes instead of allowing a conversation fragment to mutate the workspace automatically.',
        output: 'Structured context with a human approval boundary.',
      },
    ],
    evidenceRoles: [
      {
        label: 'Messages and email',
        role: 'Promises, objections, and follow-ups',
        includes:
          'Messages from linked Telegram groups, selected Slack conversations, and inbound email captured for the account or project.',
        boundary:
          'A message can establish that someone said or requested something. It does not by itself prove delivery, agreement, or commercial outcome.',
        href: '/integrations',
      },
      {
        label: 'Meetings and documents',
        role: 'Stakeholder context and durable artifacts',
        includes:
          'Consent-gated transcripts, uploaded files, and supported documents from activated Google Drive sources.',
        boundary:
          'Transcripts can contain mistakes and documents can become stale. The reviewer still decides which source is authoritative for the account.',
        href: '/integrations/google-drive',
      },
      {
        label: 'Timeline objects',
        role: 'People, company, deal, project, and task context',
        includes:
          'Structured workspace objects and suggested changes linked back to captured evidence.',
        boundary:
          'Timeline objects are broader than a traditional CRM, and this page does not claim native Salesforce or HubSpot synchronization. Durable changes require approval.',
        href: '/how-it-works',
      },
    ],
    questions: [
      'What has this customer committed to, what have we committed to, and which items remain unconfirmed?',
      'Who are the current stakeholders on this account, and which captured sources establish their roles?',
      'What changed since the last customer meeting, and which follow-ups still have no owner?',
      'Prepare an account brief that separates direct customer statements, internal interpretation, and missing evidence.',
    ],
    example: {
      label: 'Illustrative account brief',
      title: 'Expansion interest is explicit; budget approval is not.',
      body: 'A cited brief can preserve the commercially important distinction between what the customer said, what the team inferred, and what still needs confirmation.',
      claims: [
        'Stakeholder: Maya Chen owns the technical evaluation [meeting, 6 Aug]',
        'Interest: the customer requested a two-region expansion option [email, 8 Aug]',
        'Commitment: security answers are due before the next review [Slack note, 9 Aug]',
        'Gap: no captured source confirms budget authority or purchase timing',
      ],
      note: 'Fictional example. Suggested account context remains evidence-backed and human-approved.',
    },
    limitations: [
      'Timeline cannot recover account context that was never selected, sent, or successfully captured.',
      'The product’s objects are broader than a CRM; this page does not promise a native CRM data sync.',
      'A captured statement can support who said what, but not whether a deal will close or an action was completed.',
      'Private and restricted activity remains governed by the original visibility boundary.',
      'Durable object and task changes stay pending until a person approves them.',
    ],
    faqs: [
      {
        question: 'Does Timeline update a CRM automatically?',
        answer:
          'No automatic external CRM synchronization is claimed here. Timeline can connect captured evidence to its own people, company, deal, project, and task objects, while inferred durable workspace changes remain proposals until a person approves them.',
      },
      {
        question: 'Can an internal Slack comment become customer fact?',
        answer:
          'It can be preserved as an internal statement, not silently promoted to customer-confirmed fact. A good answer labels the source and distinguishes direct customer evidence from internal interpretation.',
      },
      {
        question: 'Who can see account evidence?',
        answer:
          'Timeline retrieval follows team and per-event visibility. Private or restricted evidence is only available to people included by that visibility policy.',
      },
    ],
    relatedRoutes: [SOLUTION_ROUTES.clientProjectHandoffs, SOLUTION_ROUTES.weeklyProjectUpdates],
    furtherReading: { label: 'See the evidence and approval flow', href: '/how-it-works' },
    cta: {
      title: 'Test one account question.',
      body: 'Choose one account, preserve a small evidence boundary, and ask for the brief your next customer conversation requires.',
      label: 'Try one account',
      href: '/sign-up',
    },
  },
];

export const SOLUTION_AUDIENCE_LINKS = SOLUTIONS.map((solution) => ({
  label: solution.audienceLabel,
  title: solution.shortTitle,
  href: solution.route,
})) satisfies readonly { label: string; title: string; href: SolutionRoute }[];

export const SOLUTION_CANONICAL_ROUTES = SOLUTIONS.map((solution) => solution.route);

export function findSolution(slug: string): SolutionContent | undefined {
  return SOLUTIONS.find((solution) => solution.slug === slug);
}

export function findSolutionByRoute(route: SolutionRoute): SolutionContent {
  const solution = SOLUTIONS.find((candidate) => candidate.route === route);
  if (!solution) throw new Error(`Missing solution content for ${route}`);
  return solution;
}
