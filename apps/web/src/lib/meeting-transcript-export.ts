import { formatDisplayDateParts } from '@/lib/display-dates';
import type { RegionalFormat } from '@/lib/regional-format';

interface MeetingTranscriptExportChunk {
  speaker: string | null;
  text: string;
  startMs: number;
}

export interface MeetingTranscriptExportInput {
  title: string;
  platform: string;
  status: string;
  createdAt: Date;
  meetingUrl: string;
  summary: string | null;
  chunks: MeetingTranscriptExportChunk[];
}

export function formatMeetingOffset(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function formatTranscriptExport(
  { title, platform, status, createdAt, meetingUrl, summary, chunks }: MeetingTranscriptExportInput,
  region?: RegionalFormat,
): string {
  const captured = formatDisplayDateParts(createdAt, region ?? { timezone: 'UTC' }, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    timeZoneName: 'short',
  });
  const lines = [
    `# ${title}`,
    '',
    `Platform: ${platform}`,
    `Status: ${status}`,
    `Captured: ${captured}`,
    `URL: ${meetingUrl}`,
  ];
  if (summary) lines.push('', '## Summary', '', summary);
  lines.push('', '## Transcript', '');
  if (chunks.length === 0) {
    lines.push('No transcript chunks captured.');
  } else {
    for (const c of chunks) {
      const speaker = c.speaker ? `${c.speaker}: ` : '';
      lines.push(`- ${formatMeetingOffset(c.startMs)} ${speaker}${c.text}`);
    }
  }
  return `${lines.join('\n')}\n`;
}
