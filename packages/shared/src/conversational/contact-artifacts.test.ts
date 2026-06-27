import { describe, expect, it } from 'vitest';

import {
  contactMetadata,
  extractContactsFromText,
  sourceMetadataWithContacts,
} from '#src/conversational/contact-artifacts.js';

describe('conversational contact artifacts', () => {
  it('extracts emails, Slack mailto links, phones, Slack tel links, and labeled addresses', () => {
    const contacts = extractContactsFromText(
      [
        'Loop in mika@example.com and <mailto:ada@example.com|Ada>.',
        'Call +1 213-373-4253 or <tel:+37255551234|Mika mobile>.',
        'Office address: 123 Market St, San Francisco, CA 94105',
        'Location: Room 4, 22 Test Ave',
      ].join('\n'),
    );

    expect(contactMetadata(contacts)).toMatchObject({
      emails: [
        {
          raw_value: 'ada@example.com',
          normalized_value: 'ada@example.com',
          display_value: 'ada@example.com',
          label: 'Ada',
          confidence: 'structured',
        },
        {
          raw_value: 'mika@example.com',
          normalized_value: 'mika@example.com',
          display_value: 'mika@example.com',
          label: null,
          confidence: 'explicit',
        },
      ],
      phones: [
        {
          raw_value: '+37255551234',
          normalized_value: '+37255551234',
          display_value: '+372 5555 1234',
          label: 'Mika mobile',
          country: 'EE',
          confidence: 'structured',
        },
        {
          raw_value: '+1 213-373-4253',
          normalized_value: '+12133734253',
          display_value: '+1 213 373 4253',
          country: 'US',
          confidence: 'explicit',
        },
      ],
      addresses: [
        {
          raw_value: '123 Market St, San Francisco, CA 94105',
          normalized_value: '123 market st, san francisco, ca 94105',
          display_value: '123 Market St, San Francisco, CA 94105',
          label: 'Office address',
          confidence: 'explicit',
          address_kind: 'postal_address',
        },
        {
          raw_value: 'Room 4, 22 Test Ave',
          normalized_value: 'room 4, 22 test ave',
          display_value: 'Room 4, 22 Test Ave',
          label: 'Location',
          confidence: 'explicit',
          address_kind: 'meeting_location',
        },
      ],
    });
  });

  it('dedupes by normalized value and skips URLs plus Timeline-owned inbound addresses', () => {
    const contacts = extractContactsFromText(
      [
        'Email Mika@Example.com, mika@example.com, and team-a@inbound.invalid.',
        'Do not parse https://example.com/users/mika@example.com or https://example.com/tickets/213-373-4253.',
      ].join(' '),
    );

    expect(contactMetadata(contacts)).toMatchObject({
      emails: [
        {
          normalized_value: 'mika@example.com',
          display_value: 'mika@example.com',
        },
      ],
      phones: [],
      addresses: [],
    });
  });

  it('attaches contact metadata without dropping existing source metadata', () => {
    expect(
      sourceMetadataWithContacts(
        { provider: 'slack', links: [{ canonical_url: 'https://example.com' }] },
        'Reach Ada at ada@example.com.',
      ),
    ).toMatchObject({
      provider: 'slack',
      links: [{ canonical_url: 'https://example.com' }],
      contacts: {
        emails: [{ normalized_value: 'ada@example.com' }],
        phones: [],
        addresses: [],
      },
    });
  });
});
