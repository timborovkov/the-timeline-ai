import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

describe('dedupe-calendar-events script', () => {
  it('defaults to dry-run and queues cancellation approvals in apply mode', () => {
    const source = readFileSync(new URL('./dedupe-calendar-events.ts', import.meta.url), 'utf8');

    expect(source).toContain('let dryRun = true');
    expect(source).toContain("operation: 'archive_or_cancel'");
    expect(source).toContain('createOrMergeSuggestionBundle');
    expect(source).not.toContain('deleteCalendarEvent(');
  });

  it('scans paginated calendar pages and keeps stopword-only title fallbacks', () => {
    const source = readFileSync(new URL('./dedupe-calendar-events.ts', import.meta.url), 'utf8');

    expect(source).toContain('listCalendarEventPage');
    expect(source).toContain('offset');
    expect(source).not.toContain('if (tokens.length === 0) continue');
    expect(source).toContain(
      "titleTokens(event.title).join('+') || event.title.toLowerCase().trim()",
    );
  });
});
