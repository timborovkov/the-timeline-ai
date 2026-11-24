import { expect } from '@timeline/test-support';
import { describe, it } from 'bun:test';

import { formatMeetingOffset, formatTranscriptExport } from '@/lib/meeting-transcript-export';
describe('meeting transcript export', () => {
  it('formats transcript chunks with metadata, summary, speakers, and offsets', () => {
    const exported = formatTranscriptExport({
      title: 'Daily',
      platform: 'meet',
      status: 'completed',
      createdAt: new Date('2026-06-02T12:34:56.000Z'),
      meetingUrl: 'https://meet.google.com/abc-defg-hij',
      summary: 'Launch scope narrowed and follow-up owners were agreed.',
      chunks: [
        {
          speaker: 'Taylor Bennett',
          text: 'Let us ship the transcript export.',
          startMs: 0,
        },
        {
          speaker: null,
          text: 'Unattributed utterance still exports.',
          startMs: 62_000,
        },
      ],
    });

    expect(exported).toContain('# Daily');
    expect(exported).toContain('Platform: meet');
    expect(exported).toContain('Status: completed');
    expect(exported).toContain('URL: https://meet.google.com/abc-defg-hij');
    expect(exported).toContain(
      '## Summary\n\nLaunch scope narrowed and follow-up owners were agreed.',
    );
    expect(exported).toContain('- 00:00 Taylor Bennett: Let us ship the transcript export.');
    expect(exported).toContain('- 01:02 Unattributed utterance still exports.');
  });

  it('formats the captured instant in the viewer region while keeping elapsed offsets', () => {
    const input = {
      title: 'Midnight review',
      platform: 'meet',
      status: 'completed',
      createdAt: new Date('2026-12-01T00:15:00Z'),
      meetingUrl: 'https://meet.google.com/example',
      summary: null,
      chunks: [{ speaker: null, text: 'First line', startMs: 7_000 }],
    };
    const losAngeles = formatTranscriptExport(input, {
      locale: 'en-US',
      timezone: 'America/Los_Angeles',
    });
    const tokyo = formatTranscriptExport(input, { locale: 'de-DE', timezone: 'Asia/Tokyo' });
    expect(losAngeles).toMatch(/Captured: Nov 30, 2026(?:,| at) 4:15:00 PM PST/);
    expect(tokyo).toMatch(/Captured: 1\. Dez\. 2026, 0?9:15:00 GMT\+9/);
    expect(losAngeles).toContain('- 00:07 First line');
    expect(tokyo).toContain('- 00:07 First line');
  });

  it('keeps empty transcripts explicit', () => {
    expect(
      formatTranscriptExport({
        title: 'Empty meeting',
        platform: 'meet',
        status: 'failed',
        createdAt: new Date('2026-06-02T12:34:56.000Z'),
        meetingUrl: 'https://meet.google.com/abc-defg-hij',
        summary: null,
        chunks: [],
      }),
    ).toContain('No transcript chunks captured.');
  });

  it('formats millisecond offsets as transcript timestamps', () => {
    expect(formatMeetingOffset(3_754_000)).toBe('62:34');
  });
});
