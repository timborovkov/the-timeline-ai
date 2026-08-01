// @vitest-environment happy-dom

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

const fakes = vi.hoisted(() => ({
  getDocumentPreviewUrlAction: vi.fn(),
}));

vi.mock('next/image', () => ({
  default: ({
    fill: _fill,
    unoptimized: _unoptimized,
    ...props
  }: React.ImgHTMLAttributes<HTMLImageElement> & { fill?: boolean; unoptimized?: boolean }) => (
    <img {...props} alt={props.alt ?? ''} />
  ),
}));
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));
vi.mock('@/app/actions/documents', () => ({
  getDocumentPreviewUrlAction: fakes.getDocumentPreviewUrlAction,
}));

const { DocumentPreview } = await import('./document-preview.js');

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('DocumentPreview', () => {
  it('uses a bounded image canvas for compact previews', async () => {
    fakes.getDocumentPreviewUrlAction.mockResolvedValue({
      ok: true,
      url: 'https://example.com/screenshot.png',
      filename: 'screenshot.png',
      contentType: 'image/png',
      mediaKind: 'image',
    });
    const user = userEvent.setup();

    render(<DocumentPreview target={{ versionId: 'version-1' }} compact />);
    await user.click(screen.getByRole('button', { name: 'Preview' }));

    const image = await screen.findByRole('img', { name: 'screenshot.png' });
    const canvasClasses = image.parentElement?.className.split(' ') ?? [];
    expect(canvasClasses).toEqual(expect.arrayContaining(['aspect-[4/3]', 'max-h-48', 'w-64']));
    expect(canvasClasses).not.toEqual(expect.arrayContaining(['h-[58vh]', 'min-h-72']));
  });

  it('keeps the file safe and offers a keyboard-operable retry when signing fails', async () => {
    fakes.getDocumentPreviewUrlAction
      .mockResolvedValueOnce({ ok: false, error: 'Preview service is unavailable' })
      .mockResolvedValueOnce({
        ok: true,
        url: 'https://example.com/recovered.png',
        filename: 'recovered.png',
        contentType: 'image/png',
        mediaKind: 'image',
      });
    const user = userEvent.setup();

    render(<DocumentPreview target={{ versionId: 'version-1' }} />);
    await user.click(screen.getByRole('button', { name: 'Preview' }));

    expect((await screen.findByRole('alert')).textContent).toContain(
      'Could not load this preview: Preview service is unavailable. The original file remains unchanged.',
    );
    const retry = screen.getByRole('button', { name: 'Try again' });
    await user.tab();
    expect(document.activeElement).toBe(retry);
    await user.keyboard('{Enter}');

    expect(await screen.findByRole('img', { name: 'recovered.png' })).toBeTruthy();
    await waitFor(() => {
      expect(screen.queryByRole('alert')).toBeNull();
    });
  });

  it('recovers with an inline retry when the preview request throws', async () => {
    fakes.getDocumentPreviewUrlAction
      .mockRejectedValueOnce(new Error('network unavailable'))
      .mockResolvedValueOnce({
        ok: true,
        url: 'https://example.com/recovered-after-throw.png',
        filename: 'recovered-after-throw.png',
        contentType: 'image/png',
        mediaKind: 'image',
      });
    const user = userEvent.setup();

    render(<DocumentPreview target={{ versionId: 'version-1' }} />);
    await user.click(screen.getByRole('button', { name: 'Preview' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Preview unavailable');

    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('img', { name: 'recovered-after-throw.png' })).toBeTruthy();
  });

  it('announces auto-preview loading outside its busy placeholder', async () => {
    let resolvePreview: (value: unknown) => void = () => undefined;
    fakes.getDocumentPreviewUrlAction.mockImplementation(
      () => new Promise((resolve) => (resolvePreview = resolve)),
    );

    render(<DocumentPreview target={{ versionId: 'version-1' }} autoLoad showButton={false} />);

    const loadingAnnouncements = await screen.findAllByText('Loading preview…');
    expect(
      loadingAnnouncements.find((element) => element.getAttribute('aria-live') === 'polite'),
    ).toBeTruthy();
    expect(screen.getByLabelText('Loading preview').getAttribute('aria-busy')).toBe('true');

    resolvePreview({
      ok: true,
      url: 'https://example.com/auto.png',
      filename: 'auto.png',
      contentType: 'image/png',
      mediaKind: 'image',
    });
    expect(await screen.findByRole('img', { name: 'auto.png' })).toBeTruthy();
  });
});
