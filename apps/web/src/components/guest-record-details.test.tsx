import { expect } from '@timeline/test-support';
import { describe, it } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { SharedRecordDetails } from '@/components/guest-record-details';
import { WorkspaceTimezoneProvider } from '@/components/workspace-timezone-context';

const dueDate = '2026-07-15T00:30:00.000Z';

describe('guest record deadlines', () => {
  it('keeps a date-only deadline on the same calendar day in disparate zones', () => {
    const record = {
      live: true,
      body: null,
      status: null,
      dueDate: '2026-12-01T00:00:00.000Z',
    };
    for (const timezone of ['America/Los_Angeles', 'Asia/Tokyo']) {
      const html = renderToStaticMarkup(
        <WorkspaceTimezoneProvider timezone="UTC" region={{ locale: 'de-DE', timezone }}>
          <SharedRecordDetails record={record} />
        </WorkspaceTimezoneProvider>,
      );
      expect(html).toContain('<time dateTime="2026-12-01">01.12.2026</time>');
    }
  });

  for (const [locale, timezone] of [
    ['en-US', 'America/Los_Angeles'],
    ['ja-JP', 'Asia/Tokyo'],
  ]) {
    it(`shows the same instant in ${timezone} with the local date and time`, () => {
      const html = renderToStaticMarkup(
        <WorkspaceTimezoneProvider timezone="UTC" region={{ locale, timezone }}>
          <SharedRecordDetails record={{ live: true, body: null, status: 'open', dueDate }} />
        </WorkspaceTimezoneProvider>,
      );
      expect(html).toContain(
        new Intl.DateTimeFormat(locale, {
          dateStyle: 'medium',
          timeStyle: 'short',
          timeZone: timezone,
        }).format(new Date(dueDate)),
      );
      expect(html).toContain(`dateTime="${dueDate}"`);
      expect(html).not.toContain('>2026-07-15</time>');
    });
  }
});
