// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ReactNode } from 'react';

const fakes = vi.hoisted(() => ({
  inspector: {
    open: false,
    content: null as null | {
      id: string;
      kind: string;
      title?: string;
      render: () => ReactNode;
    },
    hide: vi.fn(),
    toggle: vi.fn(),
    show: vi.fn(),
  },
}));

vi.mock('@/components/inspector-context', () => ({
  useInspector: () => fakes.inspector,
}));

const { InspectorPane } = await import('./inspector-pane.js');

beforeEach(() => {
  vi.clearAllMocks();
  fakes.inspector.open = false;
  fakes.inspector.content = null;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('InspectorPane', () => {
  it('renders nothing without active inspector content', () => {
    render(<InspectorPane />);

    expect(screen.queryByLabelText('Inspector')).toBeNull();
  });

  it('renders active content as a mobile sheet and desktop side pane', () => {
    fakes.inspector.open = true;
    fakes.inspector.content = {
      id: 'moment-1',
      kind: 'Moment',
      title: 'CI passed',
      render: () => createElement('p', null, '2 source events'),
    };

    render(<InspectorPane />);

    const pane = screen.getByLabelText('Inspector');
    expect(pane.className).toContain('fixed inset-x-0 bottom-0');
    expect(pane.className).toContain('max-h-[min(82dvh,42rem)]');
    expect(pane.className).toContain('lg:sticky');
    expect(pane.className).toContain('lg:w-96');
    expect(screen.getByText('CI passed')).toBeTruthy();
    expect(screen.getByText('2 source events')).toBeTruthy();
  });

  it('lets mobile users dismiss the sheet from the backdrop or close button', async () => {
    const user = userEvent.setup();
    fakes.inspector.open = true;
    fakes.inspector.content = {
      id: 'moment-1',
      kind: 'Moment',
      title: 'CI passed',
      render: () => createElement('p', null, '2 source events'),
    };

    render(<InspectorPane />);

    const backdrop = screen.getByRole('button', { name: 'Dismiss inspector' });
    expect(backdrop.className).toContain('lg:hidden');

    await user.click(backdrop);
    await user.click(screen.getByRole('button', { name: 'Close inspector' }));

    expect(fakes.inspector.hide).toHaveBeenCalledTimes(2);
  });

  it('restores focus to the element that opened the inspector', async () => {
    fakes.inspector.open = true;
    fakes.inspector.content = {
      id: 'moment-1',
      kind: 'Moment',
      title: 'CI passed',
      render: () => createElement('p', null, '2 source events'),
    };

    const opener = document.createElement('button');
    opener.type = 'button';
    opener.textContent = 'Open CI passed';
    document.body.append(opener);
    opener.focus();

    const { rerender } = render(<InspectorPane />);

    await waitFor(() => {
      expect(document.activeElement?.getAttribute('aria-label')).toBe('Close inspector');
    });

    fakes.inspector.open = false;
    rerender(<InspectorPane />);

    await waitFor(() => {
      expect(document.activeElement).toBe(opener);
    });

    opener.remove();
  });

  it('focuses the page fallback when the opener no longer survives refresh', async () => {
    fakes.inspector.open = true;
    fakes.inspector.content = {
      id: 'moment-1',
      kind: 'Moment',
      title: 'Removed message',
      render: () => createElement('p', null, 'Evidence'),
    };
    const fallback = document.createElement('h2');
    fallback.tabIndex = -1;
    fallback.dataset.inspectorFocusFallback = '';
    fallback.textContent = 'Timeline';
    document.body.append(fallback);
    const opener = document.createElement('button');
    opener.type = 'button';
    opener.textContent = 'Open removed message';
    document.body.append(opener);
    opener.focus();

    const { rerender } = render(<InspectorPane />);
    await waitFor(() => {
      expect(document.activeElement?.getAttribute('aria-label')).toBe('Close inspector');
    });

    opener.remove();
    fakes.inspector.open = false;
    rerender(<InspectorPane />);

    await waitFor(() => {
      expect(document.activeElement).toBe(fallback);
    });
    fallback.remove();
  });

  it('keeps keyboard focus inside the mobile inspector', async () => {
    vi.spyOn(window, 'matchMedia').mockImplementation(
      (query) =>
        ({
          matches: false,
          media: query,
          onchange: null,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
          addListener: vi.fn(),
          removeListener: vi.fn(),
          dispatchEvent: vi.fn(),
        }) as MediaQueryList,
    );
    const user = userEvent.setup();
    fakes.inspector.open = true;
    fakes.inspector.content = {
      id: 'moment-1',
      kind: 'Moment',
      title: 'CI passed',
      render: () => createElement('button', { type: 'button' }, 'Open evidence'),
    };
    const outside = document.createElement('button');
    outside.type = 'button';
    outside.textContent = 'Outside action';
    document.body.append(outside);

    render(<InspectorPane />);
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close inspector' }));
    });

    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Open evidence' }));
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close inspector' }));

    outside.remove();
  });

  it('includes native technical-detail summaries in the mobile focus order', async () => {
    vi.spyOn(window, 'matchMedia').mockImplementation(
      (query) =>
        ({
          matches: false,
          media: query,
          onchange: null,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
          addListener: vi.fn(),
          removeListener: vi.fn(),
          dispatchEvent: vi.fn(),
        }) as MediaQueryList,
    );
    fakes.inspector.open = true;
    fakes.inspector.content = {
      id: 'moment-1',
      kind: 'Moment',
      title: 'CI passed',
      render: () =>
        createElement(
          'details',
          null,
          createElement('summary', null, 'Technical details'),
          createElement('button', { type: 'button' }, 'Copy Event ID'),
        ),
    };

    render(<InspectorPane />);
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close inspector' }));
    });

    const summary = screen.getByText('Technical details');
    summary.focus();
    expect(document.activeElement).toBe(summary);
    fireEvent.keyDown(summary, { key: 'Tab' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close inspector' }));
  });

  it('leaves keyboard handling to a portaled dialog opened from the inspector', async () => {
    vi.spyOn(window, 'matchMedia').mockImplementation(
      (query) =>
        ({
          matches: false,
          media: query,
          onchange: null,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
          addListener: vi.fn(),
          removeListener: vi.fn(),
          dispatchEvent: vi.fn(),
        }) as MediaQueryList,
    );
    fakes.inspector.open = true;
    fakes.inspector.content = {
      id: 'moment-1',
      kind: 'Moment',
      title: 'CI passed',
      render: () => createElement('button', { type: 'button' }, 'Open evidence'),
    };

    render(<InspectorPane />);
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close inspector' }));
    });

    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    const dialogAction = document.createElement('button');
    dialogAction.type = 'button';
    dialogAction.textContent = 'Download evidence';
    dialog.append(dialogAction);
    document.body.append(dialog);
    dialogAction.focus();

    dialogAction.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Tab' }));
    expect(document.activeElement).toBe(dialogAction);
    dialogAction.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }));
    expect(fakes.inspector.hide).not.toHaveBeenCalled();

    dialog.remove();
  });
});
