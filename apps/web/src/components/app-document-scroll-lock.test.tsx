// @vitest-environment happy-dom

import { cleanup, render, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { AppDocumentScrollLock } from '@/components/app-document-scroll-lock';

const html = document.documentElement;
const body = document.body;

afterEach(() => {
  cleanup();
  html.removeAttribute('style');
  body.removeAttribute('style');
});

describe('AppDocumentScrollLock', () => {
  it('locks document scrolling while mounted and restores previous inline styles', async () => {
    html.style.overflow = 'auto';
    html.style.height = '90%';
    body.style.overflow = 'scroll';
    body.style.height = '80%';

    const { unmount } = render(<AppDocumentScrollLock />);

    expect(html.style.overflow).toBe('hidden');
    expect(html.style.height).toBe('100%');
    expect(body.style.overflow).toBe('hidden');
    expect(body.style.height).toBe('100%');

    unmount();

    await waitFor(() => {
      expect(html.style.overflow).toBe('auto');
      expect(html.style.height).toBe('90%');
      expect(body.style.overflow).toBe('scroll');
      expect(body.style.height).toBe('80%');
    });
  });

  it('restores document scrolling after nested body locks clean up', async () => {
    const { unmount } = render(
      <>
        <AppDocumentScrollLock />
        <BodyOverflowLock />
      </>,
    );

    expect(body.style.overflow).toBe('hidden');

    unmount();

    await waitFor(() => {
      expect(html.style.overflow).toBe('');
      expect(html.style.height).toBe('');
      expect(body.style.overflow).toBe('');
      expect(body.style.height).toBe('');
    });
  });

  it('keeps the original snapshot across immediate unmount and remount', async () => {
    html.style.overflow = 'auto';
    html.style.height = '90%';
    body.style.overflow = 'scroll';
    body.style.height = '80%';

    const first = render(<AppDocumentScrollLock />);
    first.unmount();

    const second = render(<AppDocumentScrollLock />);
    second.unmount();

    await waitFor(() => {
      expect(html.style.overflow).toBe('auto');
      expect(html.style.height).toBe('90%');
      expect(body.style.overflow).toBe('scroll');
      expect(body.style.height).toBe('80%');
    });
  });
});

function BodyOverflowLock() {
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  return null;
}
