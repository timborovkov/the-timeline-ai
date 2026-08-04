// @vitest-environment happy-dom

import { cleanup, render, fireEvent } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { Coachmark } from '@/components/coachmark';

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('Coachmark', () => {
  it('renders when localStorage has no dismiss key', () => {
    const { container } = render(<Coachmark storageKey="test-hint">Try this</Coachmark>);
    expect(container.textContent).toContain('Try this');
  });

  it('does not render when already dismissed in localStorage', () => {
    localStorage.setItem('tl-coachmark:test-hint', 'dismissed');
    const { container } = render(<Coachmark storageKey="test-hint">Try this</Coachmark>);
    expect(container.textContent).not.toContain('Try this');
  });

  it('hides and persists dismissal on close button click', () => {
    const { container } = render(<Coachmark storageKey="close-test">Try this</Coachmark>);
    expect(container.textContent).toContain('Try this');
    const closeButton = container.querySelector('button[aria-label="Dismiss hint"]');
    expect(closeButton).toBeTruthy();
    if (closeButton) fireEvent.click(closeButton);
    expect(container.textContent).not.toContain('Try this');
    expect(localStorage.getItem('tl-coachmark:close-test')).toBe('dismissed');
  });

  it('renders with a note role for assistive tech', () => {
    const { container } = render(<Coachmark storageKey="a11y-test">Hint</Coachmark>);
    expect(container.querySelector('[role="note"]')).toBeTruthy();
  });

  it('keeps a visible keyboard focus indicator on its dismiss control', () => {
    const { container } = render(<Coachmark storageKey="focus-test">Hint</Coachmark>);
    const closeButton = container.querySelector('button[aria-label="Dismiss hint"]');

    expect(closeButton?.className).toContain('focus-visible:ring-2');
    expect(closeButton?.className).toContain('focus-visible:ring-fg');
    expect(closeButton?.className).toContain('forced-colors:focus-visible:outline-2');
  });
});
