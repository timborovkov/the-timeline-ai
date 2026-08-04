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

  it('keeps technical details closed until requested and wraps long recovery values', () => {
    const { container } = render(
      <InlineError message="Failed." details="TypeError: Cannot read token of undefined" />,
    );
    const disclosure = container.querySelector('details');
    expect(disclosure?.open).toBe(false);
    const detailsSummary = Array.from(container.querySelectorAll('summary')).find((summary) =>
      /technical details/i.test(summary.textContent),
    );
    expect(detailsSummary).toBeTruthy();
    if (detailsSummary) fireEvent.click(detailsSummary);
    const pre = container.querySelector('pre');
    expect(disclosure?.open).toBe(true);
    expect(pre).toBeTruthy();
    expect(pre?.textContent).toContain('Cannot read token');
    expect(pre?.className).toContain('max-w-full');
    expect(pre?.className).toContain('whitespace-pre-wrap');
    expect(pre?.className).toContain('break-words');
  });

  it('does not render a details toggle when details is omitted', () => {
    const noop = vi.fn();
    const { container } = render(<InlineError message="Failed." onRetry={noop} />);
    expect(findButtonByText(container, /details/i)).toBeUndefined();
  });

  it('keeps opened technical details on their own row beside a retry action', () => {
    const { container } = render(
      <InlineError
        message="Sync failed."
        details="Connection reference: abc123"
        onRetry={vi.fn()}
      />,
    );

    expect(findButtonByText(container, /try again/i)).toBeTruthy();
    const disclosure = container.querySelector('details');
    expect(disclosure?.className).toContain('basis-full');
    const summary = disclosure?.querySelector('summary');
    if (summary) fireEvent.click(summary);
    expect(disclosure?.open).toBe(true);
    expect(disclosure?.querySelector('pre')?.textContent).toContain('Connection reference: abc123');
  });
});
