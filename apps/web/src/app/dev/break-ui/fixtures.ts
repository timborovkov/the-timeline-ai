import type { TeamMemberInfo, TeamMemberRow } from '@/components/team-member-types';

export const DATASETS = ['demo', 'worst', 'empty', 'one', 'huge'] as const;
export type Dataset = (typeof DATASETS)[number];

type Profile = Pick<TeamMemberInfo, 'name' | 'email'> | undefined;
const demo: Profile[] = [
  { name: 'Avery Timeline', email: 'avery@example.com' },
  { name: 'Mika Product', email: 'mika@example.com' },
  { name: 'Jordan Hale', email: 'jordan@example.com' },
];
const worst: Profile[] = [
  { name: 'Aleksandra Wiśniewska-Kowalczyk', email: 'aleksandra@example.com' },
  {
    name: 'Christopher Alexander Montgomery III',
    email: 'bartholomew.fitzgerald@northwind-industries-holdings.example.com',
  },
  { name: 'J', email: 'j@example.com' },
  { name: 'Jo', email: 'first.last+billing-notifications@example.com' },
  { name: 'Đặng Thị Ngọc Hân', email: 'han@example.com' },
  { name: '王秀英', email: 'wang@example.com' },
  { name: 'نور الهدى عبد الرحمن', email: 'nur@example.com' },
  { name: '👩🏽‍💻 Priya', email: 'priya@example.com' },
  { name: '🦊 Fox', email: 'fox@example.com' },
  { name: "Seán O'Brien-Ó Súilleabháin", email: 'sean@example.com' },
  { name: '  Sam   Lee ', email: 'sam@example.com' },
  { name: '', email: 'ops@sub.department.region.example.co.uk' },
  { name: null, email: 'bartholomew.fitzgerald@northwind-industries-holdings.example.com' },
  undefined,
  { name: '   ', email: null },
  { name: 'Alex Kim', email: 'alex.design@example.com' },
  { name: 'Alex Kim', email: 'alex.engineering@example.com' },
  { name: '<script>alert(1)</script> &amp; **bold**', email: 'escaping@example.com' },
  { name: 'María José de la Cruz y Fernández\nGarcía', email: 'maria@example.com' },
  { name: 'dana', email: 'dana@example.com' },
  { name: 'Ólafur Darri Ólafsson', email: 'olafur@example.com' },
];

function memberFixture(dataset: Dataset) {
  const profiles =
    dataset === 'empty'
      ? []
      : dataset === 'one'
        ? demo.slice(0, 1)
        : dataset === 'huge'
          ? Array.from({ length: 1284 }, (_, index) => ({
              name: `${['Alex Kim', 'Sam Lee', 'Jordan Hale'][index % 3]}`,
              email: `colleague.${index + 1}@example.com`,
            }))
          : dataset === 'worst'
            ? worst
            : demo;
  const members: TeamMemberRow[] = [];
  const userMap = new Map<string, TeamMemberInfo>();
  profiles.forEach((profile, index) => {
    // Synthetic IDs cannot select a persisted UUID-backed account.
    const id = `break-ui-member-${index}`;
    members.push({
      userId: id,
      role: index === 0 ? 'owner' : index % 3 === 1 ? 'admin' : 'member',
    });
    if (profile) userMap.set(id, { id, ...profile });
  });
  return { members, userMap };
}

export function relatedMemberFixtures(dataset: Dataset) {
  const fixture = memberFixture(dataset);
  return {
    ...fixture,
    invites: fixture.members.map((member, index) => ({
      id: `break-ui-invite-${index}`,
      email: fixture.userMap.get(member.userId)?.email ?? `invited.${index}@example.com`,
      role: member.role === 'owner' ? 'admin' : member.role,
      token: `synthetic-preview-token-${index}`,
      expiresAt: new Date('2026-11-24T12:00:00Z'),
      lastSentAt: index % 2 ? null : new Date('2026-11-10T12:00:00Z'),
      sendStatus: index % 3 === 0 ? 'failed' : index % 3 === 1 ? 'sent' : 'pending',
      sendError:
        index % 3 === 0
          ? 'The recipient mailbox is temporarily unavailable. Please retry later.'
          : null,
      invitedByUserId: dataset === 'worst' && index === 0 ? 'break-ui-member-14' : member.userId,
    })),
    removedMembers: fixture.members.map((member, index) => ({
      ...member,
      removedAt: index % 2 ? null : new Date('2026-11-01T12:00:00Z'),
    })),
  };
}
