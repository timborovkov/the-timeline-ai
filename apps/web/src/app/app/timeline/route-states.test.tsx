// @vitest-environment happy-dom

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import TimelineError from '@/app/app/timeline/error';
import TimelineLoading from '@/app/app/timeline/loading';

const timelineDir = dirname(fileURLToPath(import.meta.url));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Timeline route states', () => {
  it('keeps one calm page heading and lets keyboard users retry a failed load', async () => {
    const user = userEvent.setup();
    const reset = vi.fn();

    render(<TimelineError error={new Error('route failed')} reset={reset} />);

    expect(screen.getByRole('heading', { name: 'Timeline', level: 1 })).toBeTruthy();
    expect(screen.getByText('Review captured event history and cited evidence.')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Unable to load timeline', level: 2 })).toBeTruthy();
    expect(
      screen.getByText(
        'Your event history has not changed. Check your connection, then try again.',
      ),
    ).toBeTruthy();

    const retry = screen.getByRole('button', { name: 'Retry' });
    retry.focus();
    await user.keyboard('{Enter}');

    expect(reset).toHaveBeenCalledOnce();
  });

  it('announces timeline loading outside the busy fallback and retains a route heading', () => {
    render(<TimelineLoading />);

    expect(screen.getByRole('status').textContent).toBe('Loading timeline');
    expect(screen.getByLabelText('Loading timeline page').getAttribute('aria-busy')).toBe('true');
    expect(screen.getByRole('heading', { name: 'Timeline', level: 1 })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Timeline loading placeholder' })).toBeTruthy();
    expect(document.querySelector('[data-loading-toolbar="collection"]')).toBeTruthy();
    expect(screen.getByLabelText('Loading timeline page').getAttribute('data-app-layout')).toBe(
      'flush-top',
    );
  });

  it('keeps page-header error recovery inside normal main padding', () => {
    render(<TimelineError error={new Error('route failed')} reset={vi.fn()} />);

    expect(document.querySelector('[data-app-layout="flush-top"]')).toBeNull();
  });

  it('opts the live timeline into flush-top instead of a negative sticky offset', () => {
    const page = readFileSync(join(timelineDir, 'page.tsx'), 'utf8');
    const css = readFileSync(join(timelineDir, '../../globals.css'), 'utf8');

    expect(page).toContain('data-app-layout="flush-top"');
    expect(page).toContain('sticky top-0 z-20');
    expect(page).not.toContain('top-[-');
    expect(css).toContain("#main:has(> .app-page-container > [data-app-layout='flush-top'])");
    expect(css).toContain('padding-top: 0');
  });
});
