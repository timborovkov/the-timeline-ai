import { expect } from '@timeline/test-support';
import { vi } from '@timeline/test-support';
import { afterEach, beforeEach, describe, it } from 'bun:test';
// Test environment: happy-dom

const navigation = vi.hoisted(() => ({ pathname: '/app/timeline' }));

await vi.mock(
  import.meta.resolve('next/navigation'),
  async () => ({
    ...(await import('next/navigation')),
    usePathname: () => navigation.pathname,
  }),
  () => import('next/navigation'),
);

const { cleanup, fireEvent, render, screen } = await import('@testing-library/react');
const { default: userEvent } = await import('@testing-library/user-event');

const { InspectorProvider, useInspector } = await import('./inspector-context.js');

function InspectorHarness() {
  const inspector = useInspector();
  return (
    <div>
      <button
        type="button"
        onClick={() => {
          inspector.show({
            id: 'moment-1',
            kind: 'Moment',
            title: 'CI passed',
            render: () => null,
          });
        }}
      >
        Open inspector
      </button>
      <span>{inspector.open ? 'Inspector open' : 'Inspector closed'}</span>
    </div>
  );
}

beforeEach(() => {
  navigation.pathname = '/app/timeline';
});

afterEach(() => {
  cleanup();
});

describe('InspectorProvider', () => {
  it('lets a portaled dialog handle Escape without closing the inspector', async () => {
    const user = userEvent.setup();
    render(
      <InspectorProvider>
        <InspectorHarness />
      </InspectorProvider>,
    );
    await user.click(screen.getByRole('button', { name: 'Open inspector' }));

    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    const dialogAction = document.createElement('button');
    dialogAction.type = 'button';
    dialogAction.textContent = 'Close evidence';
    dialog.append(dialogAction);
    document.body.append(dialog);
    dialogAction.focus();

    fireEvent.keyDown(dialogAction, { key: 'Escape' });

    expect(screen.getByText('Inspector open')).toBeTruthy();
    dialog.remove();
  });

  it('closes the inspector for an unhandled Escape outside a nested overlay', async () => {
    const user = userEvent.setup();
    render(
      <InspectorProvider>
        <InspectorHarness />
      </InspectorProvider>,
    );
    await user.click(screen.getByRole('button', { name: 'Open inspector' }));

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(screen.getByText('Inspector closed')).toBeTruthy();
  });

  it('closes the mobile inspector when Escape originates inside its dialog', async () => {
    const user = userEvent.setup();
    render(
      <InspectorProvider>
        <InspectorHarness />
      </InspectorProvider>,
    );
    await user.click(screen.getByRole('button', { name: 'Open inspector' }));

    const inspector = document.createElement('aside');
    inspector.id = 'inspector-pane';
    inspector.setAttribute('role', 'dialog');
    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.textContent = 'Close inspector';
    inspector.append(closeButton);
    document.body.append(inspector);

    fireEvent.keyDown(closeButton, { key: 'Escape' });

    expect(screen.getByText('Inspector closed')).toBeTruthy();
    inspector.remove();
  });
});
