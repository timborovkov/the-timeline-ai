import { expect } from '@timeline/test-support';
import { describe, it } from 'bun:test';

import { hashDrivePayload } from '#src/integrations/google-drive-capture.js';
import {
  extractDriveDocumentStructuralText,
  flattenDriveDocumentTabs,
  formatDriveDocumentFromApi,
  formatDriveDocumentTabs,
} from '#src/integrations/google-drive-document.js';

function paragraph(text: string): { paragraph: { elements: { textRun: { content: string } }[] } } {
  return { paragraph: { elements: [{ textRun: { content: text } }] } };
}

describe('extractDriveDocumentStructuralText', () => {
  it('walks paragraphs, nested tables, and a table of contents', () => {
    const text = extractDriveDocumentStructuralText([
      paragraph('Intro\n'),
      {
        table: {
          tableRows: [
            {
              tableCells: [{ content: [paragraph('Acme')] }, { content: [paragraph('48k')] }],
            },
          ],
        },
      },
      { tableOfContents: { content: [paragraph('TOC\n')] } },
    ]);
    expect(text).toBe('Intro\nAcme48kTOC\n');
  });
});

describe('flattenDriveDocumentTabs', () => {
  it('walks nested child tabs in UI order', () => {
    const tabs = flattenDriveDocumentTabs([
      {
        tabProperties: { title: 'Notes' },
        documentTab: { body: { content: [paragraph('Summary\n')] } },
        childTabs: [
          {
            tabProperties: { title: 'Transcript' },
            documentTab: { body: { content: [paragraph('Said $48k\n')] } },
          },
        ],
      },
      {
        tabProperties: { title: 'Appendix' },
        documentTab: { body: { content: [paragraph('Extra\n')] } },
      },
    ]);
    expect(tabs.map((tab) => tab.title)).toEqual(['Notes', 'Transcript', 'Appendix']);
    expect(tabs[1]?.text).toBe('Said $48k\n');
  });
});

describe('formatDriveDocumentTabs', () => {
  it('hashes every tab so a later-tab edit is not equal to first-tab body text', () => {
    const first = 'Meeting notes for Northstar.\n';
    const previousSecond = 'Transcript: signed $12k.\n';
    const nextSecond = 'Transcript: signed $48k.\n';
    const previousDocument = formatDriveDocumentTabs([
      { title: 'Notes', text: first },
      { title: 'Transcript', text: previousSecond },
    ]);
    const nextDocument = formatDriveDocumentTabs([
      { title: 'Notes', text: first },
      { title: 'Transcript', text: nextSecond },
    ]);

    expect(hashDrivePayload(first)).toBe(
      hashDrivePayload(formatDriveDocumentTabs([{ title: 'Notes', text: first }])),
    );
    expect(hashDrivePayload(previousDocument)).not.toBe(hashDrivePayload(nextDocument));
    expect(nextDocument).toContain('# Tab: Transcript');
    expect(nextDocument).toContain('signed $48k');
    expect(previousDocument).toContain('# Tab: Notes');
  });

  it('keeps empty tabs in UI order so a rename or extra tab moves the hash', () => {
    const withEmpty = formatDriveDocumentTabs([
      { title: 'Visible', text: 'ok\n' },
      { title: 'Hidden notes', text: '' },
    ]);
    const renamed = formatDriveDocumentTabs([
      { title: 'Visible', text: 'ok\n' },
      { title: 'Private notes', text: '' },
    ]);
    expect(withEmpty).toBe('# Tab: Visible\nok\n\n# Tab: Hidden notes');
    expect(hashDrivePayload(withEmpty)).not.toBe(hashDrivePayload(renamed));
  });
});

describe('formatDriveDocumentFromApi', () => {
  it('uses includeTabsContent tabs and ignores first-tab-only body', () => {
    const formatted = formatDriveDocumentFromApi({
      title: 'SOW',
      body: { content: [paragraph('First tab only\n')] },
      tabs: [
        {
          tabProperties: { title: 'Notes' },
          documentTab: { body: { content: [paragraph('First tab only\n')] } },
        },
        {
          tabProperties: { title: 'Transcript' },
          documentTab: { body: { content: [paragraph('Later tab $48k\n')] } },
        },
      ],
    });
    expect(formatted).toContain('Later tab $48k');
    expect(formatted).not.toBe('First tab only\n');
  });

  it('falls back to legacy body when tabs are omitted', () => {
    expect(
      formatDriveDocumentFromApi({
        title: 'SOW',
        body: { content: [paragraph('Only body\n')] },
      }),
    ).toBe('Only body\n');
  });
});
