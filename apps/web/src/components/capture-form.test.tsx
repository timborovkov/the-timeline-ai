// @vitest-environment happy-dom

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fakes = vi.hoisted(() => ({
  refresh: vi.fn(),
  useQueryClient: vi.fn(),
  createAudioEventAction: vi.fn(),
  createTextEventAction: vi.fn(),
  requestAudioUploadAction: vi.fn(),
  finalizeDocumentVersionAction: vi.fn(),
  requestDocumentUploadAction: vi.fn(),
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: fakes.refresh }) }));
vi.mock('@tanstack/react-query', () => ({ useQueryClient: fakes.useQueryClient }));
vi.mock('@/components/audio-recorder', () => ({
  AudioRecorder: ({
    onClipChange,
  }: {
    onClipChange?: (clip: {
      blob: Blob;
      url: string;
      mimeType: string;
      durationSec: number;
    }) => void;
  }) =>
    createElement(
      'button',
      {
        type: 'button',
        onClick: () => {
          onClipChange?.({
            blob: new Blob(['recorded-audio'], { type: 'audio/webm' }),
            url: 'blob:recorded-audio',
            mimeType: 'audio/webm;codecs=opus',
            durationSec: 12,
          });
        },
      },
      'Use recorded clip',
    ),
}));
vi.mock('@/app/actions/events', () => ({
  createAudioEventAction: fakes.createAudioEventAction,
  createTextEventAction: fakes.createTextEventAction,
  requestAudioUploadAction: fakes.requestAudioUploadAction,
}));
vi.mock('@/app/actions/documents', () => ({
  finalizeDocumentVersionAction: fakes.finalizeDocumentVersionAction,
  requestDocumentUploadAction: fakes.requestDocumentUploadAction,
}));

const { CaptureForm } = await import('./capture-form.js');

beforeEach(() => {
  vi.clearAllMocks();
  fakes.useQueryClient.mockReturnValue({
    setQueriesData: vi.fn(),
    invalidateQueries: vi.fn(),
  });
  fakes.requestAudioUploadAction.mockResolvedValue({
    ok: true,
    url: 'https://storage.test/audio',
    key: 'teams/team-1/web/user-1/audio.m4a',
    contentType: 'audio/mp4',
  });
  fakes.createAudioEventAction.mockResolvedValue({ ok: true });
  fakes.requestDocumentUploadAction.mockResolvedValue({
    ok: true,
    url: 'https://storage.test/document',
    versionId: 'version-1',
    maxBytes: 25 * 1024 * 1024,
  });
  fakes.finalizeDocumentVersionAction.mockResolvedValue({ ok: true, documentId: 'doc-1' });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('CaptureForm', () => {
  it('renders team-visible composer controls', () => {
    const html = renderToStaticMarkup(
      createElement(CaptureForm, {
        currentUser: { id: 'user-1', name: 'Ada', email: 'ada@example.test' },
      }),
    );

    expect(html).toContain('What happened?');
    expect(html).toContain('Visible to team');
    expect(html).toContain('Use recorded clip');
    expect(html).toContain('Attach');
    expect(html).toContain('Audio, images, PDFs, docs, and notes');
    expect(html).toContain('Post');
  });

  it('renders private visibility when requested', () => {
    const html = renderToStaticMarkup(
      createElement(CaptureForm, {
        initialVisibility: 'private',
        currentUser: { id: 'user-1', name: 'Ada', email: 'ada@example.test' },
      }),
    );

    expect(html).toContain('Private (only me)');
  });

  it('validates empty submits before calling capture actions', async () => {
    const user = userEvent.setup();
    render(
      createElement(CaptureForm, {
        currentUser: { id: 'user-1', name: 'Ada', email: 'ada@example.test' },
      }),
    );

    await user.click(screen.getByRole('button', { name: 'Post' }));

    expect(screen.getByRole('alert').textContent).toBe(
      'Write something, record a voice note, or attach a file.',
    );
    expect(document.activeElement).toBe(screen.getByLabelText('Note'));
    expect(fakes.createTextEventAction).not.toHaveBeenCalled();
    expect(fakes.createAudioEventAction).not.toHaveBeenCalled();
    expect(fakes.requestDocumentUploadAction).not.toHaveBeenCalled();
  });

  it('exposes the note field by its accessible label', () => {
    render(
      createElement(CaptureForm, {
        currentUser: { id: 'user-1', name: 'Ada', email: 'ada@example.test' },
      }),
    );

    expect(screen.getByRole('textbox', { name: 'Note' })).toBeTruthy();
  });

  it('surfaces durable queue warnings after text capture succeeds', async () => {
    const user = userEvent.setup();
    fakes.createTextEventAction.mockResolvedValue({
      ok: true,
      warning: 'Saved, but search indexing queue is unreachable.',
    });
    render(
      createElement(CaptureForm, {
        currentUser: { id: 'user-1', name: 'Ada', email: 'ada@example.test' },
      }),
    );

    await user.type(screen.getByPlaceholderText('What happened?'), 'Customer approved launch');
    await user.click(screen.getByRole('button', { name: 'Post' }));

    expect((await screen.findByRole('status')).textContent).toBe(
      'Saved, but search indexing queue is unreachable.',
    );
    expect(fakes.createTextEventAction).toHaveBeenCalledOnce();
    expect(fakes.refresh).toHaveBeenCalledOnce();
  });

  it('posts selected audio through transcription and document files through document upload', async () => {
    const user = userEvent.setup();
    render(
      createElement(CaptureForm, {
        currentUser: { id: 'user-1', name: 'Ada', email: 'ada@example.test' },
      }),
    );

    const audio = new File(['audio-bytes'], 'meeting.m4a', { type: 'audio/x-m4a' });
    const pdf = new File(['%PDF'], 'notes.pdf', { type: 'application/pdf' });

    await user.upload(screen.getByLabelText('Attach files'), [audio, pdf]);
    await user.click(screen.getByRole('button', { name: 'Post' }));

    await waitFor(() => {
      expect(fakes.createAudioEventAction).toHaveBeenCalledOnce();
      expect(fakes.finalizeDocumentVersionAction).toHaveBeenCalledOnce();
    });
    expect(fakes.requestAudioUploadAction).toHaveBeenCalledWith('audio/x-m4a');
    expect(fakes.createAudioEventAction).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'teams/team-1/web/user-1/audio.m4a',
        mimeType: 'audio/x-m4a',
        visibility: 'team',
      }),
    );
    expect(fakes.requestDocumentUploadAction).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'notes.pdf',
        filename: 'notes.pdf',
        contentType: 'application/pdf',
        visibility: 'team',
      }),
    );
    expect(fakes.finalizeDocumentVersionAction).toHaveBeenCalledWith({ versionId: 'version-1' });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('keeps typed text and a recorded clip together as one audio event', async () => {
    const user = userEvent.setup();
    render(
      createElement(CaptureForm, {
        currentUser: { id: 'user-1', name: 'Ada', email: 'ada@example.test' },
      }),
    );

    await user.type(screen.getByPlaceholderText('What happened?'), "Today's Nexia voice note");
    await user.click(screen.getByRole('button', { name: 'Use recorded clip' }));
    await user.click(screen.getByRole('button', { name: 'Post' }));

    await waitFor(() => {
      expect(fakes.createAudioEventAction).toHaveBeenCalledOnce();
    });
    expect(fakes.createTextEventAction).not.toHaveBeenCalled();
    expect(fakes.requestAudioUploadAction).toHaveBeenCalledWith('audio/webm');
    expect(fakes.createAudioEventAction).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'teams/team-1/web/user-1/audio.m4a',
        mimeType: 'audio/webm',
        noteText: "Today's Nexia voice note",
        durationSec: 12,
        visibility: 'team',
      }),
    );
  });

  it('keeps only failed attachments selected after a partial upload failure', async () => {
    fakes.finalizeDocumentVersionAction
      .mockRejectedValueOnce(new Error('Finalize failed for notes.pdf'))
      .mockResolvedValueOnce({ ok: true, documentId: 'doc-1' });
    const user = userEvent.setup();
    render(
      createElement(CaptureForm, {
        currentUser: { id: 'user-1', name: 'Ada', email: 'ada@example.test' },
      }),
    );

    const audio = new File(['audio-bytes'], 'meeting.m4a', { type: 'audio/x-m4a' });
    const pdf = new File(['%PDF'], 'notes.pdf', { type: 'application/pdf' });

    await user.upload(screen.getByLabelText('Attach files'), [audio, pdf]);
    await user.click(screen.getByRole('button', { name: 'Post' }));

    expect(await screen.findByText('Finalize failed for notes.pdf')).toBeTruthy();
    expect(screen.queryByText('meeting.m4a')).toBeNull();
    expect(screen.getByText('notes.pdf')).toBeTruthy();
    expect(fakes.refresh).toHaveBeenCalledOnce();

    await user.click(screen.getByRole('button', { name: 'Post' }));

    await waitFor(() => {
      expect(fakes.finalizeDocumentVersionAction).toHaveBeenCalledTimes(2);
    });
    expect(fakes.requestAudioUploadAction).toHaveBeenCalledOnce();
    expect(fakes.createAudioEventAction).toHaveBeenCalledOnce();
    expect(fakes.requestDocumentUploadAction).toHaveBeenCalledTimes(2);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(fakes.refresh).toHaveBeenCalledTimes(2);
  });

  it('does not force extension-only webm files through audio transcription', async () => {
    const user = userEvent.setup();
    render(
      createElement(CaptureForm, {
        currentUser: { id: 'user-1', name: 'Ada', email: 'ada@example.test' },
      }),
    );

    const webm = new File(['webm-bytes'], 'clip.webm');

    await user.upload(screen.getByLabelText('Attach files'), webm);
    await user.click(screen.getByRole('button', { name: 'Post' }));

    await waitFor(() => {
      expect(fakes.finalizeDocumentVersionAction).toHaveBeenCalledOnce();
    });
    expect(fakes.requestAudioUploadAction).not.toHaveBeenCalled();
    expect(fakes.createAudioEventAction).not.toHaveBeenCalled();
    expect(fakes.requestDocumentUploadAction).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'clip.webm',
        filename: 'clip.webm',
        contentType: 'application/octet-stream',
      }),
    );
  });
});
