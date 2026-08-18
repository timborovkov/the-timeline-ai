import { DEMO_IDS, DEMO_LOGIN_PASSWORD } from '../demo-fixture.js';

import { CORPUS_UUID } from './ids.js';

export const CORPUS_PASSWORD = DEMO_LOGIN_PASSWORD;

export interface CorpusPerson {
  key: 'avery' | 'mika' | 'jordan' | 'sam' | 'riley' | 'casey' | 'quinn' | 'harper';
  id: string;
  name: string;
  email: string;
  role: 'owner' | 'admin' | 'member';
  title: string;
  timezone: string;
}

export const CORPUS_PEOPLE: readonly CorpusPerson[] = [
  {
    key: 'avery',
    id: DEMO_IDS.owner,
    name: 'Avery Timeline',
    email: 'owner@timeline.dev',
    role: 'owner',
    title: 'CEO',
    timezone: 'Europe/Helsinki',
  },
  {
    key: 'mika',
    id: DEMO_IDS.member,
    name: 'Mika Product',
    email: 'member@timeline.dev',
    role: 'member',
    title: 'Head of Product',
    timezone: 'Europe/Helsinki',
  },
  {
    key: 'jordan',
    id: CORPUS_UUID.user(1),
    name: 'Jordan Hale',
    email: 'jordan@timeline.dev',
    role: 'admin',
    title: 'Head of Engineering',
    timezone: 'Europe/Helsinki',
  },
  {
    key: 'sam',
    id: CORPUS_UUID.user(2),
    name: 'Sam Rivera',
    email: 'sam@timeline.dev',
    role: 'member',
    title: 'Design lead',
    timezone: 'Europe/Helsinki',
  },
  {
    key: 'riley',
    id: CORPUS_UUID.user(3),
    name: 'Riley Cho',
    email: 'riley@timeline.dev',
    role: 'member',
    title: 'Marketing lead',
    timezone: 'America/New_York',
  },
  {
    key: 'casey',
    id: CORPUS_UUID.user(4),
    name: 'Casey Novak',
    email: 'casey@timeline.dev',
    role: 'member',
    title: 'Account executive',
    timezone: 'America/Los_Angeles',
  },
  {
    key: 'quinn',
    id: CORPUS_UUID.user(5),
    name: 'Quinn Okonkwo',
    email: 'quinn@timeline.dev',
    role: 'member',
    title: 'People operations',
    timezone: 'Europe/Helsinki',
  },
  {
    key: 'harper',
    id: CORPUS_UUID.user(6),
    name: 'Harper Singh',
    email: 'harper@timeline.dev',
    role: 'member',
    title: 'Finance lead',
    timezone: 'Europe/London',
  },
] as const;

export const CORPUS_PERSON = Object.fromEntries(
  CORPUS_PEOPLE.map((person) => [person.key, person]),
) as Record<CorpusPerson['key'], CorpusPerson>;

export const CORPUS_LOGIN_EMAILS = CORPUS_PEOPLE.map((person) => person.email);
