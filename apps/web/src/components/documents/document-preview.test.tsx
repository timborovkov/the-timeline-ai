// @vitest-environment happy-dom

import { cleanup, render, screen } from '@testing-library/react';
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
});
