// @vitest-environment happy-dom

import { cleanup, render, fireEvent } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { InlineError } from '@/components/inline-error';

afterEach(() => {
  cleanup();
});

function findButtonByText(container: HTMLElement, pattern: RegExp): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll('button')).find((b) => pattern.test(b.textContent));
}

describe('InlineError', () => {
  it('renders the human message with an alert role', () => {
    const { container } = render(<InlineError message="Could not start the connection." />);
    expect(container.querySelector('[role="alert"]')).toBeTruthy();
    expect(container.textContent).toContain('Could not start the connection.');
  });

  it('renders a Try again button bound to onRetry', () => {
    const onRetry = vi.fn();
    const { container } = render(<InlineError message="Sync failed." onRetry={onRetry} />);
    const retryButton = findButtonByText(container, /try again/i);
    expect(retryButton).toBeTruthy();
    if (retryButton) fireEvent.click(retryButton);
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('does not render a retry button when onRetry is omitted', () => {
    const { container } = render(<InlineError message="Connection no longer exists." />);
    expect(findButtonByText(container, /try again/i)).toBeUndefined();
  });

  it('shows retrying label and disables the button when retrying is true', () => {
    const onRetry = vi.fn();
    const { container } = render(<InlineError message="Sync failed." onRetry={onRetry} retrying />);
    const retryButton = findButtonByText(container, /retrying/i);
    expect(retryButton).toBeTruthy();
    expect(retryButton?.hasAttribute('disabled')).toBe(true);
    if (retryButton) fireEvent.click(retryButton);
    expect(onRetry).not.toHaveBeenCalled();
  });

  it('toggles the details disclosure on click', () => {
    const { container } = render(
      <InlineError message="Failed." details="TypeError: Cannot read token of undefined" />,
    );
    expect(container.querySelector('pre')).toBeNull();
    const detailsButton = findButtonByText(container, /details/i);
    if (detailsButton) fireEvent.click(detailsButton);
    const pre = container.querySelector('pre');
    expect(pre).toBeTruthy();
    expect(pre?.textContent).toContain('Cannot read token');
  });

  it('does not render a details toggle when details is omitted', () => {
    const noop = vi.fn();
    const { container } = render(<InlineError message="Failed." onRetry={noop} />);
    expect(findButtonByText(container, /details/i)).toBeUndefined();
  });
});
