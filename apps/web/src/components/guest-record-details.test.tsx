import { expect } from '@timeline/test-support';
import { describe, it } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { SharedRecordDetails } from '@/components/guest-record-details';
import { WorkspaceTimezoneProvider } from '@/components/workspace-timezone-context';

const dueDate = '2026-07-15T00:30:00.000Z';

describe('guest record deadlines', () => {
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
