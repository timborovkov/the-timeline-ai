import { describe, expect, it } from 'vitest';

import type { ExtractedFact } from '#src/extract/schema.js';

import { isNoisyExtractedFact } from '#src/extract/noise.js';

function fact(statement: string): ExtractedFact {
  return { statement, confidence: 1, mentions: [] };
}

describe('isNoisyExtractedFact', () => {
  it('drops message transmission mechanics', () => {
    expect(isNoisyExtractedFact(fact('Otto shared a link to an X post.'))).toBe(true);
    expect(isNoisyExtractedFact(fact('Mia forwarded the screenshot in Telegram.'))).toBe(true);
    expect(isNoisyExtractedFact(fact('Tim reacted to the LinkedIn post.'))).toBe(true);
  });

  it('keeps durable facts that mention tools or platforms', () => {
    expect(
      isNoisyExtractedFact(fact('The team mentioned GitHub as the preferred issue tracker.')),
    ).toBe(false);
    expect(isNoisyExtractedFact(fact('AuditAI liked Excel for the first import workflow.'))).toBe(
      false,
    );
    expect(
      isNoisyExtractedFact(fact('The team decided to use WhatsApp for customer support.')),
    ).toBe(false);
  });
});
