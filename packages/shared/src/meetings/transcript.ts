export interface MeetingTranscriptLine {
  startMs: number;
  speaker: string | null;
  text: string;
}

export function formatMeetingTranscript(chunks: MeetingTranscriptLine[]): string {
  return chunks
    .map((c) => `[${String(Math.floor(c.startMs / 1000))}s] ${c.speaker ?? 'Unknown'}: ${c.text}`)
    .join('\n');
}
