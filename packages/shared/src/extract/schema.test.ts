import { describe, expect, it } from 'vitest';

import { extractionResultSchema } from '#src/extract/schema.js';

describe('extractionResultSchema', () => {
  it('accepts a well-formed extraction payload', () => {
    const parsed = extractionResultSchema.safeParse({
      facts: [
        {
          statement: 'Tim met John Ternus at Apple about SaaS licensing',
          confidence: 0.9,
          mentions: [
            { name: 'Tim', type: 'person', role: 'subject' },
            { name: 'John Ternus', type: 'person', role: 'object', aliases: ['John'] },
            { name: 'Apple', type: 'company', role: 'topic' },
            { name: 'SaaS licensing', type: 'topic', role: 'topic' },
          ],
        },
      ],
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects unknown entity types', () => {
    const parsed = extractionResultSchema.safeParse({
      facts: [
        {
          statement: 'x',
          confidence: 0.5,
          mentions: [{ name: 'X', type: 'unknown', role: 'subject' }],
        },
      ],
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects confidence outside [0,1]', () => {
    const parsed = extractionResultSchema.safeParse({
      facts: [{ statement: 'x', confidence: 1.5, mentions: [] }],
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects unknown fact roles', () => {
    const parsed = extractionResultSchema.safeParse({
      facts: [
        {
          statement: 'x',
          confidence: 0.5,
          mentions: [{ name: 'X', type: 'person', role: 'witness' }],
        },
      ],
    });
    expect(parsed.success).toBe(false);
  });
});
