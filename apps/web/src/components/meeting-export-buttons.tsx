'use client';

import { Download, Printer } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useRegionalFormat } from '@/components/workspace-timezone-context';
import {
  formatTranscriptExport,
  type MeetingTranscriptExportInput,
} from '@/lib/meeting-transcript-export';

function filenameSafe(input: string): string {
  const normalized = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || 'meeting-transcript';
}

export function MeetingExportButtons({ transcript }: { transcript: MeetingTranscriptExportInput }) {
  const region = useRegionalFormat();

  function downloadTranscript() {
    const blob = new Blob([formatTranscriptExport(transcript, region)], {
      type: 'text/markdown;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${filenameSafe(transcript.title)}.md`;
    document.body.append(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex flex-wrap gap-2 print:hidden">
      <Button type="button" variant="outline" size="sm" onClick={downloadTranscript}>
        <Download aria-hidden="true" className="size-4" />
        Download
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => {
          window.print();
        }}
      >
        <Printer aria-hidden="true" className="size-4" />
        Print/PDF
      </Button>
    </div>
  );
}
