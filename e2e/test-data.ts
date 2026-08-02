import { createHash } from 'node:crypto';

function safeRunId(value: string | undefined): string {
  return (value ?? 'local')
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 32);
}

export const E2E_RUN_ID = safeRunId(process.env.E2E_RUN_ID);
const E2E_NAMESPACE = safeRunId(process.env.E2E_NAMESPACE ?? E2E_RUN_ID);

function uuidFrom(label: string): string {
  const chars = createHash('sha256')
    .update(`${E2E_NAMESPACE}:${label}`)
    .digest('hex')
    .slice(0, 32)
    .split('');
  chars[12] = '4';
  chars[16] = ((Number.parseInt(chars[16] ?? '0', 16) & 0x3) | 0x8).toString(16);
  const hex = chars.join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export const E2E_PREFIX = `timeline-e2e-${E2E_NAMESPACE}`;
export const E2E_PASSWORD = process.env.E2E_PASSWORD ?? 'TimelineE2E!12345';

export const e2eTeam = {
  id: uuidFrom('team'),
  slug: E2E_PREFIX,
  name: `Timeline E2E ${E2E_RUN_ID}`,
  inboundEmail: `${E2E_PREFIX}@e2e.localhost`,
};

export const e2eOtherTeam = {
  id: uuidFrom('other-team'),
  slug: `${E2E_PREFIX}-other`,
  name: `Timeline E2E Other ${E2E_RUN_ID}`,
  inboundEmail: `${E2E_PREFIX}-other@e2e.localhost`,
};

export const e2eUsers = {
  owner: {
    id: uuidFrom('owner'),
    name: 'Timeline E2E Owner',
    email: `${E2E_PREFIX}-owner@example.test`,
  },
  admin: {
    id: uuidFrom('admin'),
    name: 'Timeline E2E Admin',
    email: `${E2E_PREFIX}-admin@example.test`,
  },
  member: {
    id: uuidFrom('member'),
    name: 'Timeline E2E Member',
    email: `${E2E_PREFIX}-member@example.test`,
  },
  nonMember: {
    id: uuidFrom('non-member'),
    name: 'Timeline E2E Non Member',
    email: `${E2E_PREFIX}-non-member@example.test`,
  },
  invitee: {
    id: uuidFrom('invitee'),
    name: 'Timeline E2E Invitee',
    email: `${E2E_PREFIX}-invitee@example.test`,
  },
  pendingInvitee: {
    id: uuidFrom('pending-invitee'),
    name: 'Timeline E2E Pending Invitee',
    email: `${E2E_PREFIX}-pending-invitee@example.test`,
  },
};

export const e2eSeedEvents = {
  privateForOwner: `E2E private owner note ${E2E_RUN_ID}`,
  specificForMember: `E2E specific member note ${E2E_RUN_ID}`,
  otherTeam: `E2E other team note ${E2E_RUN_ID}`,
};

export const e2eSeedTasks = {
  mobileKanban: {
    id: uuidFrom('mobile-kanban-task'),
    canonicalName: `E2E mobile Kanban task ${E2E_RUN_ID}`,
  },
};
