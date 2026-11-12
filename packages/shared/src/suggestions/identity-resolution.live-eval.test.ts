import { describe, expect, it } from 'bun:test';

import { chatStructured } from '#src/llm/chat.js';

import { resolveObjectIdentity } from '#src/suggestions/identity-resolution.js';
import { resolveSemanticIdentity } from '#src/suggestions/semantic-identity.js';

// Real model adjudication on synthetic Finnish/English project evidence. No customer data.
// Each case runs three times; exact-name-only baseline is reported separately.
const meteredChat: typeof chatStructured = async (input) => {
  const result = await chatStructured(input);
  console.warn(
    JSON.stringify({
      evaluationUsage: 'identity',
      model: result.model,
      openRouterUsd: result.openRouterUsd ?? null,
    }),
  );
  return result;
};
const live = process.env.ENGINE_IDENTITY_LIVE_EVAL === '1' ? describe : describe.skip;
const subject = { id: 'subject', type: 'project', canonicalName: 'PBC-portaali' };
const candidate = { id: 'candidate', type: 'project', canonicalName: 'Client material portal' };
const cases = [
  {
    name: 'explicit translated identity',
    expected: 'existing',
    text: 'The PBC-portaali is the same project as Client material portal: the client evidence upload portal. We use these two names interchangeably.',
  },
  {
    name: 'matching concrete scope across languages',
    expected: 'existing',
    text: 'PBC-portaali is the Northstar client evidence upload portal for audit engagement documents, owned by Mara, shipping on 15 December. Client material portal is that same Northstar audit document upload deliverable owned by Mara, shipping on 15 December.',
  },
  {
    name: 'separate sibling portals',
    expected: 'new',
    text: 'PBC-portaali handles audit evidence uploads for clients. Client material portal is a separate marketing asset download site. Both belong to Northstar.',
  },
  {
    name: 'shared meeting is not identity',
    expected: 'new',
    text: 'We discussed PBC-portaali and Client material portal at the Northstar meeting. No decision about their relationship was made.',
  },
  {
    name: 'phase with distinct scope',
    expected: 'new',
    text: 'PBC-portaali is a standalone pilot with a separate delivery contract. Client material portal is a later platform build with a different deliverable and owner. Do not merge the two projects.',
  },
];
live('live identity acceptance gate', () => {
  for (const sample of cases)
    it(
      sample.name,
      async () => {
        console.warn(
          JSON.stringify({
            case: sample.name,
            baseline: resolveObjectIdentity(subject, [candidate]).kind,
            expected: sample.expected,
          }),
        );
        for (let repeat = 0; repeat < 3; repeat++) {
          const result = await resolveSemanticIdentity(
            {
              subject,
              candidates: [candidate],
              evidence: [
                { objectId: subject.id, rawEventId: 'source-1', text: sample.text },
                { objectId: candidate.id, rawEventId: 'source-1', text: sample.text },
              ],
            },
            { chatStructured: meteredChat },
          );
          expect(result.kind).toBe(sample.expected);
          if (result.kind === 'existing') expect(result.citations?.length).toBeGreaterThan(0);
        }
      },
      180000,
    );
});
