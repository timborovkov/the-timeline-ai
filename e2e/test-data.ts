import { createHash } from 'node:crypto';

function safeRunId(value: string | undefined): string {
  return (value ?? 'local')
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 32);
}

function uuidFrom(label: string): string {
  const hex = createHash('sha256').update(`${E2E_RUN_ID}:${label}`).digest('hex').slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export const E2E_RUN_ID = safeRunId(process.env.E2E_RUN_ID);
export const E2E_PREFIX = `timeline-e2e-${E2E_RUN_ID}`;
export const E2E_PASSWORD = process.env.E2E_PASSWORD ?? 'TimelineE2E!12345';

export const e2eTeam = {
  id: uuidFrom('team'),
  slug: E2E_PREFIX,
  name: `Timeline E2E ${E2E_RUN_ID}`,
  inboundEmail: `${E2E_PREFIX}@e2e.localhost`,
};

export const e2eUsers = {
  owner: {
    id: uuidFrom('owner'),
    name: 'Timeline E2E Owner',
    email: `${E2E_PREFIX}-owner@example.test`,
  },
  member: {
    id: uuidFrom('member'),
    name: 'Timeline E2E Member',
    email: `${E2E_PREFIX}-member@example.test`,
  },
};
