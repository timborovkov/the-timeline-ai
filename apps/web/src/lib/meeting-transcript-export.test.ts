import { describe, expect, it } from 'vitest';

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
          speaker: 'Tim Borovkov',
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
    expect(exported).toContain('- 00:00 Tim Borovkov: Let us ship the transcript export.');
    expect(exported).toContain('- 01:02 Unattributed utterance still exports.');
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
