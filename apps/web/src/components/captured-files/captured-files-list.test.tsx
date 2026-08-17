// @vitest-environment happy-dom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ReactNode } from 'react';

const fakes = vi.hoisted(() => ({
  promoteCapturedFileAction: vi.fn(),
  routerPush: vi.fn(),
  notifyAction: vi.fn(),
  notifyError: vi.fn(),
}));

vi.mock('@/lib/notify', () => ({
  notifyAction: (options: { run: () => Promise<{ error?: string }> }) =>
    fakes.notifyAction(options),
  notifyError: fakes.notifyError,
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: fakes.routerPush, refresh: vi.fn() }),
}));
vi.mock('@/app/actions/documents', () => ({
  promoteCapturedFileAction: fakes.promoteCapturedFileAction,
}));
vi.mock('@/app/actions/pins', () => ({
  pinTargetAction: vi.fn(),
  unpinTargetAction: vi.fn(),
}));
vi.mock('@/components/documents/document-preview', () => ({
  DocumentPreview: () => createElement('button', { type: 'button' }, 'Preview'),
}));
vi.mock('@/components/evidence-link', () => ({
  EvidenceLink: ({ children }: { children: ReactNode }) =>
    createElement('a', { href: '/app/timeline?event=event-1#ev-event-1' }, children),
}));

const { CapturedFilesList } = await import('./captured-files-list.js');

async function openFilters(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  const trigger = screen.getAllByRole('button', { name: /^Filters/ })[0];
  if (!trigger) throw new Error('Missing filter trigger');
  await user.click(trigger);
}

type CapturedFile = Parameters<typeof CapturedFilesList>[0]['files'][number];

function capturedFile(overrides: Partial<CapturedFile> = {}): CapturedFile {
  return {
    id: 'doc-1',
    name: 'AgACAgQAAyEFAATcv6dYAAP3aimENrbqY6kNAAEqxvEv6YGMrdExAAK5DmsbjOI.jpg',
    metadata: { suggested_title: 'Whiteboard planning photo' },
    visibility: 'team' as const,
    visibilityUserIds: null,
    pinned: false,
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

beforeEach(() => {
  fakes.notifyAction.mockImplementation(async ({ run }: { run: () => Promise<{ error?: string }> }) =>
    run(),
  );
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('CapturedFilesList', () => {
  it('uses friendly labels for captured files and keeps evidence visible', () => {
    const html = renderToStaticMarkup(
      createElement(CapturedFilesList, {
        folders: [{ id: 'folder-1', name: 'Internal' }],
        members: [{ id: 'user-1', label: 'Ada' }],
        files: [capturedFile()],
      }),
    );

    expect(html).toContain('Filters');
    expect(html).toContain('Whiteboard planning photo');
    expect(html).toContain('stored as');
    expect(html).toContain(
      'title="AgACAgQAAyEFAATcv6dYAAP3aimENrbqY6kNAAEqxvEv6YGMrdExAAK5DmsbjOI.jpg"',
    );
    expect(html).toContain('Telegram');
    expect(html).toContain('Ready for search');
    expect(html).toContain('Team visibility');
    expect(html).toContain('Showing 1 captured file');
    expect(html).toContain('Preview');
    expect(html).toContain('View evidence');
    expect(html).toContain('Promote');
  });

  it('keeps row promotion secondary and makes promotion primary only in its dialog', async () => {
    const user = userEvent.setup();
    render(<CapturedFilesList folders={[]} members={[]} files={[capturedFile()]} />);

    expect(screen.getAllByRole('button', { name: 'Filters' })).toHaveLength(2);
    expect(screen.getByRole('link', { name: 'View evidence' })).toBeTruthy();

    const promote = screen.getByRole('button', { name: 'Promote' });
    expect(promote.className).toContain('border');
    expect(promote.className).not.toContain('bg-primary');

    await user.click(promote);

    const dialog = screen.getByRole('dialog', { name: 'Promote to Documents' });
    expect(within(dialog).getByRole('button', { name: 'Promote' }).className).toContain(
      'bg-primary',
    );
    expect(within(dialog).getByText('Who can view it')).toBeTruthy();
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

  it('opens promotion in an accessible responsive dialog and restores trigger focus on Escape', async () => {
    const user = userEvent.setup();
    render(<CapturedFilesList folders={[]} members={[]} files={[capturedFile()]} />);

    const trigger = screen.getByRole('button', { name: 'Promote' });
    await user.click(trigger);

    const dialog = screen.getByRole('dialog', { name: 'Promote to Documents' });
    expect(within(dialog).getByRole('textbox', { name: 'Title' })).toHaveProperty(
      'value',
      'Whiteboard planning photo',
    );
    expect(dialog.className).toContain('max-h-[calc(100dvh-2rem)]');
    expect(dialog.className).toContain('overflow-y-auto');

    await user.keyboard('{Escape}');

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(document.activeElement).toBe(trigger);
  });

  it('keeps promotion form values and lets the user retry when promotion fails', async () => {
    fakes.promoteCapturedFileAction.mockResolvedValue({ ok: false, error: 'network timeout' });
    const user = userEvent.setup();
    render(<CapturedFilesList folders={[]} members={[]} files={[capturedFile()]} />);

    await user.click(screen.getByRole('button', { name: 'Promote' }));
    const dialog = screen.getByRole('dialog', { name: 'Promote to Documents' });
    await user.click(within(dialog).getByRole('button', { name: 'Promote' }));

    await waitFor(() => {
      expect(fakes.notifyAction).toHaveBeenCalledWith(
        expect.objectContaining({
          success: 'Promoted to documents',
          error: 'Couldn’t promote captured file',
        }),
      );
    });
    expect(within(dialog).getByRole('textbox', { name: 'Title' })).toHaveProperty(
      'value',
      'Whiteboard planning photo',
    );
    expect(fakes.routerPush).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole('button', { name: 'Promote' }));
    await waitFor(() => {
      expect(fakes.promoteCapturedFileAction).toHaveBeenCalledTimes(2);
    });
  });

  it('explains a blank promotion title, focuses it, and lets the user recover', async () => {
    fakes.promoteCapturedFileAction.mockResolvedValue({ ok: true, documentId: 'promoted-doc' });
    const user = userEvent.setup();
    render(<CapturedFilesList folders={[]} members={[]} files={[capturedFile()]} />);

    await user.click(screen.getByRole('button', { name: 'Promote' }));
    const dialog = screen.getByRole('dialog', { name: 'Promote to Documents' });
    const title = within(dialog).getByRole('textbox', { name: 'Title' });
    await user.clear(title);
    await user.keyboard('{Enter}');

    expect(screen.getByText('Enter a title before promoting this file.')).toBeTruthy();
    expect(title.getAttribute('aria-invalid')).toBe('true');
    expect(title.getAttribute('aria-describedby')).toBe('captured-file-title-error');
    expect(title.getAttribute('aria-required')).toBe('true');
    expect(document.activeElement).toBe(title);
    expect(fakes.promoteCapturedFileAction).not.toHaveBeenCalled();

    await user.type(title, 'Roadmap photo');
    expect(screen.queryByText('Enter a title before promoting this file.')).toBeNull();
    expect(title.getAttribute('aria-invalid')).toBe('false');

    await user.click(within(dialog).getByRole('button', { name: 'Promote' }));
    await waitFor(() => {
      expect(fakes.promoteCapturedFileAction).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Roadmap photo' }),
      );
    });
  });

  it('replaces a failed promotion with title guidance before retrying', async () => {
    fakes.promoteCapturedFileAction.mockResolvedValue({ ok: false, error: 'network timeout' });
    const user = userEvent.setup();
    render(<CapturedFilesList folders={[]} members={[]} files={[capturedFile()]} />);

    await user.click(screen.getByRole('button', { name: 'Promote' }));
    const dialog = screen.getByRole('dialog', { name: 'Promote to Documents' });
    await user.click(within(dialog).getByRole('button', { name: 'Promote' }));
    await waitFor(() => {
      expect(fakes.notifyAction).toHaveBeenCalledWith(
        expect.objectContaining({ error: 'Couldn’t promote captured file' }),
      );
    });

    const liveDialog = screen.getByRole('dialog', { name: 'Promote to Documents' });
    const title = within(liveDialog).getByRole('textbox', { name: 'Title' });
    await user.clear(title);
    await user.click(within(liveDialog).getByRole('button', { name: 'Promote' }));

    expect(screen.getByText('Enter a title before promoting this file.')).toBeTruthy();
    expect(fakes.promoteCapturedFileAction).toHaveBeenCalledTimes(1);
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

    await openFilters(user);
    await user.click(screen.getByRole('button', { name: 'Status' }));
    await user.click(screen.getByRole('menuitemcheckbox', { name: 'Ready for search' }));
    await user.click(screen.getByRole('menuitemcheckbox', { name: 'Ready' }));
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

  it('keeps loaded files visible and offers inline retry when loading older files fails', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));
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

    expect(
      await screen.findByText(
        'Could not load older captured files. The files already shown remain available. Check your connection, then try again.',
      ),
    ).toBeTruthy();
    expect(fakes.notifyError).toHaveBeenCalledWith(
      'captured-files:load-more',
      'Couldn’t load older captured files',
    );
    expect(screen.getByText('Whiteboard planning photo')).toBeTruthy();

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: 'Retry loading older files' }).hasAttribute('disabled'),
      ).toBe(false);
    });
    const retry = screen.getByRole('button', { name: 'Retry loading older files' });
    retry.focus();
    await user.keyboard('{Enter}');
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });
});
