// @vitest-environment happy-dom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ReactNode } from 'react';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
const fakes = vi.hoisted(() => ({
  promoteCapturedFileAction: vi.fn(),
  routerPush: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: fakes.routerPush, refresh: vi.fn() }),
}));
vi.mock('@/app/actions/documents', () => ({
  promoteCapturedFileAction: fakes.promoteCapturedFileAction,
}));
vi.mock('@/components/documents/document-preview', () => ({
  DocumentPreview: () => createElement('button', { type: 'button' }, 'Preview'),
}));
vi.mock('@/components/evidence-link', () => ({
  EvidenceLink: ({ children }: { children: ReactNode }) =>
    createElement('a', { href: '/app/timeline?event=event-1#ev-event-1' }, children),
}));

const { CapturedFilesList } = await import('./captured-files-list.js');

type CapturedFile = Parameters<typeof CapturedFilesList>[0]['files'][number];

function capturedFile(overrides: Partial<CapturedFile> = {}): CapturedFile {
  return {
    id: 'doc-1',
    name: 'AgACAgQAAyEFAATcv6dYAAP3aimENrbqY6kNAAEqxvEv6YGMrdExAAK5DmsbjOI.jpg',
    metadata: { suggested_title: 'Whiteboard planning photo' },
    visibility: 'team' as const,
    visibilityUserIds: null,
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
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('CapturedFilesList', () => {
  it('renders filters, suggested titles, preview, event link, and promote affordance', () => {
    const html = renderToStaticMarkup(
      createElement(CapturedFilesList, {
        folders: [{ id: 'folder-1', name: 'Internal' }],
        members: [{ id: 'user-1', label: 'Ada' }],
        files: [capturedFile()],
      }),
    );

    expect(html).toContain('All sources');
    expect(html).toContain('Whiteboard planning photo');
    expect(html).toContain('stored as');
    expect(html).toContain(
      'title="AgACAgQAAyEFAATcv6dYAAP3aimENrbqY6kNAAEqxvEv6YGMrdExAAK5DmsbjOI.jpg"',
    );
    expect(html).toContain('Preview');
    expect(html).toContain('Event');
    expect(html).toContain('Promote');
  });

  it('preserves specific-user visibility defaults when promoting', async () => {
    fakes.promoteCapturedFileAction.mockResolvedValue({ ok: true, documentId: 'promoted-doc' });
    const user = userEvent.setup();
    render(
      <CapturedFilesList
        folders={[]}
        members={[
          { id: 'user-1', label: 'Ada' },
          { id: 'user-2', label: 'Grace' },
        ]}
        files={[
          capturedFile({
            visibility: 'specific_users',
            visibilityUserIds: ['user-2'],
          }),
        ]}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Promote' }));
    expect(screen.getByRole('checkbox', { name: 'Grace' })).toHaveProperty('checked', true);
    const promoteButtons = screen.getAllByRole('button', { name: 'Promote' });
    const confirmPromote = promoteButtons.at(-1);
    if (!confirmPromote) throw new Error('missing promote dialog button');
    await user.click(confirmPromote);

    await waitFor(() => {
      expect(fakes.promoteCapturedFileAction).toHaveBeenCalledWith(
        expect.objectContaining({
          visibility: 'specific_users',
          visibilityUserIds: ['user-2'],
        }),
      );
    });
    expect(fakes.routerPush).toHaveBeenCalledWith('/app/documents/promoted-doc');
  });

  it('filters captured files by multiple selected statuses', async () => {
    const user = userEvent.setup();
    render(
      <CapturedFilesList
        folders={[]}
        members={[]}
        files={[
          capturedFile(),
          capturedFile({
            id: 'doc-2',
            currentVersion: {
              id: 'version-2',
              version: 1,
              contentType: 'application/pdf',
              byteSize: 2048,
              processingStatus: 'embedded',
              createdAt: '2026-06-11T10:00:00.000Z',
            },
            presentation: {
              displayTitle: 'Embedded contract',
              storedName: 'contract.pdf',
              suggestedTitle: null,
              isGeneratedName: false,
              fallbackTitle: 'PDF attachment',
            },
          }),
          capturedFile({
            id: 'doc-3',
            currentVersion: null,
            presentation: {
              displayTitle: 'Pending screenshot',
              storedName: 'pending.png',
              suggestedTitle: null,
              isGeneratedName: false,
              fallbackTitle: 'Image attachment',
            },
          }),
        ]}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Status' }));
    await user.click(screen.getByRole('menuitemcheckbox', { name: 'chunked' }));
    await user.click(screen.getByRole('menuitemcheckbox', { name: 'embedded' }));
    await user.keyboard('{Escape}');

    expect(screen.queryByText('Whiteboard planning photo')).not.toBeNull();
    expect(screen.queryByText('Embedded contract')).not.toBeNull();
    expect(screen.queryByText('Pending screenshot')).toBeNull();
  });

  it('loads older captured pages from the cursor API', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          items: [
            capturedFile({
              id: 'doc-2',
              name: 'old.pdf',
              currentVersion: {
                id: 'version-2',
                version: 1,
                contentType: 'application/pdf',
                byteSize: 2048,
                processingStatus: 'embedded',
                createdAt: '2026-06-01T10:00:00.000Z',
              },
              presentation: {
                displayTitle: 'Old contract',
                storedName: 'old.pdf',
                suggestedTitle: null,
                isGeneratedName: false,
                fallbackTitle: 'PDF attachment',
              },
            }),
          ],
          nextCursor: null,
        }),
      ),
    );
    const user = userEvent.setup();
    render(
      <CapturedFilesList
        folders={[]}
        members={[]}
        files={[capturedFile()]}
        nextCursor="older-cursor"
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Load older captured files' }));

    await waitFor(() => {
      expect(screen.queryByText('Old contract')).not.toBeNull();
    });
    expect(fetchMock).toHaveBeenCalledWith('/api/documents/captured?cursor=older-cursor');
  });
});
