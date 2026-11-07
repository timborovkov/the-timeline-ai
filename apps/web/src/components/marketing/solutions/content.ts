import type { MarketingScreenshotSlot } from '@/components/marketing/screenshot-slot';
import type { PublicCanonicalPath } from '@/lib/public-site';

export const SOLUTION_ROUTES = {
  clientProjectHandoffs: '/solutions/client-project-handoffs',
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
  related: readonly {
    href: PublicCanonicalPath;
    eyebrow: string;
    title: string;
    description: string;
  }[];
  furtherReading?: { label: string; href: PublicCanonicalPath };
  screenshots?: readonly MarketingScreenshotSlot[];
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
    eyebrow: 'Use case · Client handoffs',
    title: 'Hand off the whole project, not a reconstruction.',
    summary:
      'The Timeline keeps the project’s work record current from its Slack or Telegram threads, email and calls, so the next owner can see what changed, why, and the source for every line.',
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
      'The Timeline is a work record built from the conversations a team sends it. It orders that work by time without pretending every source has equal authority. The handoff can therefore state what is known, show where it came from, and leave conflicts visible for the incoming owner.',
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
    related: [
      {
        href: '/use-cases/onboarding-and-repeat-questions',
        eyebrow: 'Use case · Onboarding',
        title: 'Onboarding and repeat questions',
        description: 'Answer it once, and new people find it with its source.',
      },
      {
        href: '/use-cases/team-daily-log',
        eyebrow: 'Use case · Team daily log',
        title: 'Team daily log',
        description:
          'A daily update for the workspace, written from what the team said and shipped.',
      },
    ],
    furtherReading: { label: 'See how selected work becomes cited history', href: '/how-it-works' },
    screenshots: [
      {
        file: '32-ask-handoff-dark.png',
        alt: 'A stored Ask handoff brief citing Northstar sources from Drive, GitHub, Linear, and Slack.',
        caption:
          'A cited answer for a client handoff names Drive, GitHub, Linear and Slack sources instead of blending them. This screenshot shows a stored Ask answer from the fictional Acme Labs demo; it is not live generated proof.',
      },
    ],
    cta: {
      title: 'Test one real handoff.',
      body: 'Choose one project, preserve only its relevant sources, and ask the question the next owner actually needs answered.',
      label: 'Start free',
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
  const solution = SOLUTIONS[0];
  if (!solution) throw new Error(`Missing solution content for ${route}`);
  return solution;
}
