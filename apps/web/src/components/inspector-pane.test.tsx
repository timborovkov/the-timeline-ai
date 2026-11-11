import { expect } from '@timeline/test-support';
import { vi } from '@timeline/test-support';
import { afterEach, beforeEach, describe, it } from 'bun:test';

import type { ReactNode } from 'react';
// Test environment: happy-dom

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

await vi.mock(
  import.meta.resolve('@/components/inspector-context'),
  () => ({
    useInspector: () => fakes.inspector,
  }),
  () => import('@/components/inspector-context'),
);

const { cleanup, render, screen, waitFor } = await import('@testing-library/react');
const { default: userEvent } = await import('@testing-library/user-event');
const { createElement } = await import('react');

const { Dialog, DialogContent, DialogTitle, DialogTrigger } =
  await import('@/components/ui/dialog');

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

  it('renders active content in a fixed overlay without resizing the workspace', () => {
    fakes.inspector.open = true;
    fakes.inspector.content = {
      id: 'moment-1',
      kind: 'Moment',
      title: 'CI passed',
      render: () => createElement('p', null, '2 source events'),
    };

    render(<InspectorPane />);

    const pane = screen.getByLabelText('Inspector');
    expect(pane.className).toContain('fixed inset-y-0 right-0');
    expect(pane.className).toContain('max-w-3xl');
    expect(pane.getAttribute('role')).toBe('dialog');
    expect(screen.getByText('CI passed')).toBeTruthy();
    expect(screen.getByText('2 source events')).toBeTruthy();
  });

  it('lets users dismiss the inspector with Escape or its close button', async () => {
    const user = userEvent.setup();
    fakes.inspector.open = true;
    fakes.inspector.content = {
      id: 'moment-1',
      kind: 'Moment',
      title: 'CI passed',
      render: () => createElement('p', null, '2 source events'),
    };

    render(<InspectorPane />);

    await user.keyboard('{Escape}');
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
          dispatchEvent: vi.fn(),
        }) as unknown as MediaQueryList,
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

  it('keeps expanded technical-detail controls in the focus order', async () => {
    vi.spyOn(window, 'matchMedia').mockImplementation(
      (query) =>
        ({
          matches: false,
          media: query,
          onchange: null,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
          dispatchEvent: vi.fn(),
        }) as unknown as MediaQueryList,
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
    const user = userEvent.setup();
    await user.click(summary);
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Copy Event ID' }));
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close inspector' }));
  });

  it('leaves focus and Escape handling to a nested dialog', async () => {
    const user = userEvent.setup();
    fakes.inspector.open = true;
    fakes.inspector.content = {
      id: 'moment-1',
      kind: 'Moment',
      title: 'CI passed',
      render: () => (
        <Dialog>
          <DialogTrigger asChild>
            <button type="button">Open evidence</button>
          </DialogTrigger>
          <DialogContent aria-describedby={undefined}>
            <DialogTitle>Evidence</DialogTitle>
            <button type="button">Download evidence</button>
          </DialogContent>
        </Dialog>
      ),
    };
    render(<InspectorPane />);
    await user.click(screen.getByRole('button', { name: 'Open evidence' }));
    await waitFor(() => {
      expect(document.activeElement).toBe(
        screen.getByRole('button', { name: 'Download evidence' }),
      );
    });
    await user.keyboard('{Escape}');
    expect(fakes.inspector.hide).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Open evidence' }));
    });
  });
});
