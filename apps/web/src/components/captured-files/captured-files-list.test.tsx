import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import type { ReactNode } from 'react';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock('@/app/actions/documents', () => ({ promoteCapturedFileAction: vi.fn() }));
vi.mock('@/components/documents/document-preview', () => ({
  DocumentPreview: () => createElement('button', { type: 'button' }, 'Preview'),
}));
vi.mock('@/components/evidence-link', () => ({
  EvidenceLink: ({ children }: { children: ReactNode }) =>
    createElement('a', { href: '/app/timeline?event=event-1#ev-event-1' }, children),
}));

const { CapturedFilesList } = await import('./captured-files-list.js');

describe('CapturedFilesList', () => {
  it('renders filters, suggested titles, preview, event link, and promote affordance', () => {
    const html = renderToStaticMarkup(
      createElement(CapturedFilesList, {
        folders: [{ id: 'folder-1', name: 'Internal' }],
        members: [{ id: 'user-1', label: 'Ada' }],
        files: [
          {
            id: 'doc-1',
            name: 'AgACAgQAAyEFAATcv6dYAAP3aimENrbqY6kNAAEqxvEv6YGMrdExAAK5DmsbjOI.jpg',
            metadata: { suggested_title: 'Whiteboard planning photo' },
            visibility: 'team',
            updatedAt: '2026-06-11T10:00:00.000Z',
            sourceRawEventId: 'event-1',
            currentVersion: {
              id: 'version-1',
              version: 1,
              contentType: 'image/jpeg',
              byteSize: 1024,
              processingStatus: 'chunked',
              createdAt: '2026-06-11T10:00:00.000Z',
            },
            provenance: {
              source: 'telegram',
              parentEventId: 'event-1',
              occurredAt: '2026-06-11T09:58:00.000Z',
              summary: 'Telegram attachment',
            },
            description: 'A photo of a whiteboard with planning notes.',
            presentation: {
              displayTitle: 'Whiteboard planning photo',
              storedName: 'AgACAgQAAyEFAATcv6dYAAP3aimENrbqY6kNAAEqxvEv6YGMrdExAAK5DmsbjOI.jpg',
              suggestedTitle: 'Whiteboard planning photo',
              isGeneratedName: true,
              fallbackTitle: 'Image attachment',
            },
          },
        ],
      }),
    );

    expect(html).toContain('All sources');
    expect(html).toContain('Whiteboard planning photo');
    expect(html).toContain('stored as');
    expect(html).toContain('Preview');
    expect(html).toContain('Event');
    expect(html).toContain('Promote');
  });
});
