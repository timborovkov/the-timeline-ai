import { describe, expect, it } from 'vitest';

import type { ExtractedFact } from '#src/extract/schema.js';

import {
  isLowSignalEntityMention,
  isLowSignalObjectName,
  isNoisyExtractedFact,
} from '#src/extract/noise.js';

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

describe('isLowSignalEntityMention', () => {
  it('drops generic topic and other mentions', () => {
    expect(isLowSignalEntityMention({ name: 'financial data', type: 'topic', role: 'topic' })).toBe(
      true,
    );
    expect(
      isLowSignalEntityMention({ name: 'company financial data', type: 'topic', role: 'topic' }),
    ).toBe(true);
    expect(
      isLowSignalEntityMention({ name: 'customer relationships', type: 'other', role: 'topic' }),
    ).toBe(true);
    expect(isLowSignalEntityMention({ name: 'PE firms', type: 'topic', role: 'topic' })).toBe(true);
    expect(
      isLowSignalEntityMention({ name: 'healthcare providers', type: 'topic', role: 'topic' }),
    ).toBe(true);
    expect(isLowSignalEntityMention({ name: 'SaaS tools', type: 'topic', role: 'topic' })).toBe(
      true,
    );
    expect(isLowSignalEntityMention({ name: 'Verottaja', type: 'company', role: 'topic' })).toBe(
      true,
    );
    expect(
      isLowSignalEntityMention({ name: 'Tax Administration', type: 'company', role: 'topic' }),
    ).toBe(true);
    expect(isLowSignalEntityMention({ name: 'KILA', type: 'company', role: 'topic' })).toBe(true);
    expect(isLowSignalEntityMention({ name: 'Finlex', type: 'company', role: 'topic' })).toBe(true);
    expect(isLowSignalEntityMention({ name: 'AI in robotics', type: 'topic', role: 'topic' })).toBe(
      true,
    );
  });

  it('keeps named work topics and non-topic object types', () => {
    expect(isLowSignalEntityMention({ name: 'Q3 roadmap', type: 'topic', role: 'topic' })).toBe(
      false,
    );
    expect(
      isLowSignalEntityMention({ name: 'Q3 roadmap for AuditAI', type: 'topic', role: 'topic' }),
    ).toBe(false);
    expect(isLowSignalEntityMention({ name: 'SaaS licensing', type: 'topic', role: 'topic' })).toBe(
      false,
    );
    expect(
      isLowSignalEntityMention({ name: 'SaaS licensing for Apple', type: 'topic', role: 'topic' }),
    ).toBe(false);
    expect(
      isLowSignalEntityMention({
        name: 'FY2026 hiring plan for KPMG',
        type: 'topic',
        role: 'topic',
      }),
    ).toBe(false);
    expect(isLowSignalEntityMention({ name: 'Q3 vendors', type: 'topic', role: 'topic' })).toBe(
      false,
    );
    expect(isLowSignalEntityMention({ name: 'KPMG providers', type: 'topic', role: 'topic' })).toBe(
      false,
    );
    expect(
      isLowSignalEntityMention({ name: 'financial data', type: 'project', role: 'topic' }),
    ).toBe(false);
    expect(isLowSignalObjectName({ name: 'AuditAI', type: 'company' })).toBe(false);
    expect(isLowSignalObjectName({ name: 'KPMG', type: 'company' })).toBe(false);
    expect(isLowSignalObjectName({ name: 'financial data', type: 'project' })).toBe(false);
  });

  it('drops generic SaaS and platform names when emitted as company objects', () => {
    expect(isLowSignalObjectName({ name: 'Google Drive', type: 'company' })).toBe(true);
    expect(isLowSignalObjectName({ name: 'GitHub', type: 'company' })).toBe(true);
    expect(isLowSignalObjectName({ name: 'TikTok', type: 'company' })).toBe(true);
    expect(isLowSignalObjectName({ name: 'browser-based', type: 'company' })).toBe(true);
    expect(isLowSignalObjectName({ name: 'PE firms', type: 'company' })).toBe(true);
    expect(isLowSignalObjectName({ name: 'healthcare providers', type: 'vendor' })).toBe(true);
    expect(isLowSignalObjectName({ name: 'GitHub', type: 'project' })).toBe(true);
    expect(isLowSignalObjectName({ name: 'Excel', type: 'project' })).toBe(true);
    expect(isLowSignalObjectName({ name: 'Verottaja', type: 'project' })).toBe(true);
  });

  it('keeps real company and vendor names with category-like suffixes', () => {
    expect(isLowSignalObjectName({ name: 'Acme Systems', type: 'company' })).toBe(false);
    expect(isLowSignalObjectName({ name: 'Northstar Software', type: 'vendor' })).toBe(false);
    expect(isLowSignalObjectName({ name: 'KPMG Vendors', type: 'company' })).toBe(false);
  });
});
