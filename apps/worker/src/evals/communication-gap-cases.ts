import type { Family } from '#src/evals/communication-cases.js';
import type { CommunicationNode } from '#src/evals/communication-types.js';
const company = (name: string, key = 'company'): CommunicationNode => ({
  key,
  type: 'company',
  name,
});
const project = (name: string, status = 'planning'): CommunicationNode => ({
  key: 'project',
  type: 'project',
  name,
  status,
});
const task = (name: string, key = 'task'): CommunicationNode => ({
  key,
  type: 'task',
  name,
  status: 'todo',
  terms: name
    .toLowerCase()
    .split(' ')
    .filter(
      (word) =>
        word.length > 3 && !['prepare', 'review', 'draft', 'write', 'create'].includes(word),
    )
    .map((word) => [word]),
});
const msg = (text: string) => ({ text });
const customer = (from = 'task', to = 'company') => ({ from, to, kind: 'related' as const });
/** New families are split by underlying scenario, never by source paraphrase. */
export const communicationGapFamilies: Family[] = [
  {
    id: 'unsigned-funded-discovery',
    optionalCompanyProjectAssociation: true,
    category: 'uncertainty',
    split: 'development',
    rationale:
      'Budget discussion is not a signed engagement; preserve tentative company/project context.',
    uncertain: true,
    messages: [
      msg(
        'We are discussing a potential engagement with Willow Research for a concrete proposed project, Specimen Index. Their budget exists but no contract is signed. Track the possible project for review, not as active delivery.',
      ),
    ],
    nodes: [company('Willow Research'), project('Specimen Index')],
  },
  {
    id: 'confirmed-client-new-bid',
    optionalCompanyProjectAssociation: true,
    category: 'uncertainty',
    split: 'development',
    rationale: 'A new prospective project must not downgrade the existing customer.',
    uncertain: true,
    seed: [company('Harbor Analytics')],
    messages: [
      msg(
        'Our existing customer Harbor Analytics is considering a possible project called Evidence Vault. No contract for this new project is signed. Keep it as a planning proposal; our existing account is unchanged.',
      ),
    ],
    nodes: [company('Harbor Analytics'), project('Evidence Vault')],
  },
  {
    id: 'declined-prospect-no-project',
    category: 'uncertainty',
    split: 'development',
    rationale: 'An explicitly declined inquiry does not establish a tracked account or project.',
    messages: [
      msg(
        'Aspen Retail declined our offer before any engagement. Their idea was an Inventory Canvas project, but they have decided not to pursue it. There is no relationship or work to track.',
      ),
    ],
    nodes: [],
  },
  {
    id: 'procurement-shortlist',
    optionalCompanyProjectAssociation: true,
    category: 'uncertainty',
    split: 'held-out',
    rationale: 'Shortlisting is a real prospective engagement but not a contract.',
    uncertain: true,
    messages: [
      msg(
        'We made the shortlist for a potential engagement with Copper Museum. The proposed project is Archive Navigator. Procurement has not awarded a contract. Keep this possible engagement for review with the project still planning.',
      ),
    ],
    nodes: [company('Copper Museum'), project('Archive Navigator')],
  },
  {
    id: 'conditional-grant-project',
    optionalCompanyProjectAssociation: true,
    category: 'uncertainty',
    split: 'held-out',
    rationale: 'A real proposed project contingent on a grant remains tentative.',
    uncertain: true,
    messages: [
      msg(
        'A possible engagement with Elm Foundation would deliver the proposed project Grant Ledger if their grant arrives. Funding is not approved and no contract is signed. Record the potential company and planning project, without tasks.',
      ),
    ],
    nodes: [company('Elm Foundation'), project('Grant Ledger')],
  },
  {
    id: 'existing-project-prospect-comparison',
    optionalCompanyProjectAssociation: true,
    category: 'uncertainty',
    split: 'held-out',
    rationale:
      'A hypothetical sales comparison must not downgrade active delivery or create fictional prospects.',
    seed: [company('Granite Logistics'), project('Route Register', 'active')],
    messages: [
      msg(
        'Our customer Granite Logistics and active Route Register project are unchanged. In sales training we compare them with a fictional prospect called Silver Transit. That imaginary example is not an engagement; do not change our existing work.',
      ),
    ],
    nodes: [company('Granite Logistics'), project('Route Register', 'active')],
  },
  {
    id: 'separate-customer-reports',
    category: 'routing',
    split: 'development',
    rationale:
      'Two separately named deliverables each belong to their explicitly identified customer, without owners or dates.',
    seed: [company('Juniper Energy'), company('Maple Energy', 'second-company')],
    messages: [
      msg(
        'Please draft a usage report for Juniper Energy and a separate outage report for Maple Energy. Link each task to its customer. Nobody has taken ownership and neither has a deadline.',
      ),
    ],
    nodes: [
      company('Juniper Energy'),
      company('Maple Energy', 'second-company'),
      task('Draft Juniper Energy usage report'),
      task('Draft Maple Energy outage report', 'second-task'),
    ],
    edges: [customer(), customer('second-task', 'second-company')],
  },
  {
    id: 'account-alias-link',
    category: 'routing',
    split: 'development',
    rationale: 'A unique existing customer alias is reusable identity, not a new account.',
    seed: [{ ...company('Northwind Medical'), aliases: ['NWM'] }],
    messages: [
      msg(
        'Please prepare the NWM compliance checklist for our customer Northwind Medical. Link the checklist to Northwind Medical. No owner or deadline yet.',
      ),
    ],
    nodes: [company('Northwind Medical'), task('Prepare Northwind Medical compliance checklist')],
    edges: [customer()],
  },
  {
    id: 'client-association-unresolved',
    category: 'routing',
    split: 'development',
    rationale:
      'Ambiguous account selection must preserve the standalone task without guessing a relationship.',
    seed: [company('Oak Clinic'), company('Pine Clinic', 'second-company')],
    messages: [
      msg(
        'Please prepare the consent template. It may be for Oak Clinic or Pine Clinic; we have not decided which customer. Leave the customer link, assignee and deadline unset.',
      ),
    ],
    nodes: [
      company('Oak Clinic'),
      company('Pine Clinic', 'second-company'),
      task('Prepare consent template'),
    ],
  },
  {
    id: 'joint-customer-deliverable',
    category: 'routing',
    split: 'held-out',
    rationale:
      'One explicitly shared deliverable must remain one task with both customer relationships, rather than being split into independent tasks.',
    seed: [company('Larch Studio'), company('Birch Studio', 'second-company')],
    messages: [
      msg(
        'Larch Studio and Birch Studio commissioned one shared interface specification. Please draft that single interface specification and link the task to both customer accounts. This is one joint artifact, not two independent specifications. No owner or deadline has been chosen.',
      ),
    ],
    nodes: [
      company('Larch Studio'),
      company('Birch Studio', 'second-company'),
      task('Draft interface specification'),
    ],
    edges: [customer(), customer('task', 'second-company')],
  },
  {
    id: 'company-mentioned-in-background',
    category: 'routing',
    split: 'held-out',
    rationale: 'Background mention of a second customer does not authorize a task link to it.',
    seed: [company('Delta Housing'), company('Echo Housing', 'second-company')],
    messages: [
      msg(
        'Echo Housing sent a newsletter. Separately, please prepare the tenant import checklist for Delta Housing and link that task to Delta Housing. The checklist is unrelated to Echo Housing; no owner or date is set.',
      ),
    ],
    nodes: [
      company('Delta Housing'),
      company('Echo Housing', 'second-company'),
      task('Prepare Delta Housing tenant import checklist'),
    ],
    edges: [customer()],
  },
  {
    id: 'shared-account-alias-ambiguous',
    category: 'routing',
    split: 'held-out',
    rationale: 'An alias shared by two customers is not sufficient identity for an attachment.',
    seed: [
      { ...company('Clearwater East'), aliases: ['Clearwater'] },
      { ...company('Clearwater West', 'second-company'), aliases: ['Clearwater'] },
    ],
    messages: [
      msg(
        'Please draft the retention summary for Clearwater. We have not established whether the request came from Clearwater East or Clearwater West. Track the task without choosing an account, owner or deadline.',
      ),
    ],
    nodes: [
      company('Clearwater East'),
      company('Clearwater West', 'second-company'),
      task('Draft retention summary'),
    ],
  },
  {
    id: 'requester-not-volunteer',
    category: 'attribution',
    split: 'development',
    rationale: 'Sending a work request is not a personal commitment.',
    messages: [
      {
        text: 'Please review the encryption checklist. I am requesting this for the team, not volunteering to do it. We still need to choose an owner.',
        actor: 'alice',
      },
    ],
    nodes: [task('Review encryption checklist')],
  },
  {
    id: 'explicit-owner-future-work',
    category: 'attribution',
    split: 'development',
    rationale:
      'A named future commitment establishes ownership without starting lifecycle progress.',
    messages: [
      msg(
        'Bob will prepare the restore checklist. He has not started it, and no deadline has been agreed.',
      ),
    ],
    nodes: [{ ...task('Prepare restore checklist'), assignee: 'bob' }],
  },
  {
    id: 'external-requester-no-member',
    category: 'attribution',
    split: 'development',
    rationale: 'An external participant cannot become a workspace assignee by proxy.',
    messages: [
      msg(
        'Our external contact Eva asks us to validate the field mapping. Eva is not a workspace member and nobody on our team has accepted ownership. No deadline was supplied.',
      ),
    ],
    nodes: [task('Validate field mapping')],
  },
  {
    id: 'named-fyi-recipient',
    category: 'attribution',
    split: 'held-out',
    rationale: 'A named FYI recipient is not the owner of work requested from the team.',
    messages: [
      {
        text: 'Alice, FYI only: the team needs to review the archive manifest. This does not assign the review to you or to me. Owner and deadline remain undecided.',
        actor: 'bob',
      },
    ],
    nodes: [task('Review archive manifest')],
  },
  {
    id: 'explicit-owner-withdrawal',
    category: 'attribution',
    split: 'held-out',
    rationale:
      'An explicit removal of the existing owner clears assignment without inventing a replacement or changing lifecycle.',
    seed: [{ ...task('Validate billing mapping'), assignee: 'bob' }],
    messages: [
      msg(
        'Unassign Bob from Validate billing mapping. He is no longer responsible and nobody replaces him; leave this task unassigned. Its status and deadline are unchanged.',
      ),
    ],
    nodes: [{ ...task('Validate billing mapping'), assignee: null }],
  },
  {
    id: 'collective-commitment-unassigned',
    category: 'attribution',
    split: 'held-out',
    rationale:
      'A collective commitment establishes work without choosing the speaker as individual owner.',
    messages: [
      {
        text: 'We will draft the rollback instructions as a team. We have not divided responsibilities or selected an individual owner, and have not set a deadline.',
        actor: 'bob',
      },
    ],
    nodes: [task('Draft rollback instructions')],
  },
  {
    id: 'date-in-history-not-deadline',
    category: 'temporal',
    split: 'development',
    rationale: 'A historical incident timestamp is not a deadline for the requested review.',
    messages: [
      msg(
        'The incident occurred on 2026-05-20. Please review the failover checklist. That incident date is background, not the review deadline; no deadline or owner has been chosen.',
      ),
    ],
    nodes: [task('Review failover checklist')],
  },
  {
    id: 'explicit-utc-deadline',
    category: 'temporal',
    split: 'development',
    rationale: 'An explicit UTC deadline must persist exactly, without inventing an owner.',
    messages: [
      msg(
        'Please prepare the schema audit. Its deadline is 2026-06-16T09:00:00Z. No assignee has been selected.',
      ),
    ],
    nodes: [{ ...task('Prepare schema audit'), dueAt: '2026-06-16T09:00:00.000Z' }],
  },
  {
    id: 'later-deadline-correction',
    category: 'temporal',
    split: 'development',
    rationale:
      'The latest explicit deadline replaces the old one without changing ownership or starting work.',
    seed: [
      { ...task('Prepare restore inventory'), dueAt: '2026-06-17T10:00:00.000Z', assignee: 'bob' },
    ],
    messages: [
      msg(
        'Correction: the deadline for Prepare restore inventory is now 2026-06-18T11:00:00Z, replacing the old date. Bob remains owner and has not started.',
      ),
    ],
    nodes: [
      { ...task('Prepare restore inventory'), dueAt: '2026-06-18T11:00:00.000Z', assignee: 'bob' },
    ],
  },
  {
    id: 'offset-crosses-utc-day',
    category: 'temporal',
    split: 'held-out',
    rationale: 'An explicit offset timestamp must normalize across the UTC date boundary.',
    messages: [
      msg(
        'Please review the storage manifest by 2026-06-22T00:30:00+02:00. This is the actual deadline; no owner is assigned.',
      ),
    ],
    nodes: [{ ...task('Review storage manifest'), dueAt: '2026-06-21T22:30:00.000Z' }],
  },
  {
    id: 'deferred-scheduling-no-date',
    category: 'temporal',
    split: 'held-out',
    rationale: 'A future scheduling discussion is not an actual deadline.',
    messages: [
      msg(
        'Please draft the migration runbook. A Tuesday discussion was suggested and explicitly rejected. There is no discussion, meeting or alternative slot to schedule. Leave the task date and owner unset.',
      ),
    ],
    nodes: [task('Draft migration runbook')],
  },
  {
    id: 'existing-deadline-preserved',
    category: 'temporal',
    split: 'held-out',
    rationale: 'A status-free ownership clarification must not clear a previously agreed deadline.',
    seed: [
      { ...task('Review export schema'), dueAt: '2026-06-25T15:00:00.000Z', assignee: 'alice' },
    ],
    messages: [
      msg(
        'For Review export schema, Alice is still responsible. This is only an ownership clarification, not a start announcement or deadline change.',
      ),
    ],
    nodes: [
      { ...task('Review export schema'), dueAt: '2026-06-25T15:00:00.000Z', assignee: 'alice' },
    ],
  },
];
